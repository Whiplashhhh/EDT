import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import compress from '@fastify/compress';
import fastifyStatic from '@fastify/static';
import { loadConfig } from './config.ts';
import { AdeService, NotFoundError } from './ade/service.ts';
import { CrousService, CrousError } from './crous/service.ts';
import { AdeError } from './ade/gwt.ts';
import { registerApi } from './routes/api.ts';
import { registerPushRoutes } from './routes/push.ts';
import { SubscriptionStore } from './push/store.ts';
import { PushSender } from './push/sender.ts';
import { Notifier } from './push/notifier.ts';

const config = loadConfig();
const service = new AdeService(config);
const crous = new CrousService(config);

/*
 * Notifications push. Le registre des abonnements est chargé même quand les
 * clés VAPID manquent : les routes restent alors fermées, mais les abonnements
 * déjà enregistrés survivent à un démarrage sans clés — une variable oubliée
 * ne doit pas désabonner tout le monde.
 */
const subscriptions = new SubscriptionStore(config.push.storePath);

const app = Fastify({
  // À n'activer que derrière un reverse proxy de confiance : sinon un client
  // pourrait forger `X-Forwarded-For` et contourner la limite de débit.
  trustProxy: process.env.TRUST_PROXY === 'true',
  bodyLimit: 8 * 1024,
  // Les journaux ne contiennent ni cookie ni identifiant : l'application n'en utilise pas.
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
});

await app.register(helmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'none'"],
      formAction: ["'none'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null,
    },
  },
  crossOriginEmbedderPolicy: false,
  referrerPolicy: { policy: 'no-referrer' },
});

await app.register(compress, { global: true, encodings: ['br', 'gzip'] });

await app.register(rateLimit, {
  max: 120,
  timeWindow: '1 minute',
  // L'API est publique et anonyme : la limite par IP suffit à protéger ADE en amont.
  keyGenerator: (req) => req.ip,
});

// CORS restreint : par défaut l'API n'est consommée que par le front servi ici.
if (config.allowedOrigins.length > 0) {
  app.addHook('onRequest', async (req, reply) => {
    const origin = req.headers.origin;
    if (origin && config.allowedOrigins.includes(origin)) {
      reply.header('Access-Control-Allow-Origin', origin);
      reply.header('Vary', 'Origin');
      reply.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    }
    if (req.method === 'OPTIONS') reply.code(204).send();
  });
}

/*
 * Chaque réponse d'erreur porte un `code` stable en plus de son message français :
 * le front est bilingue et traduit le code lui-même plutôt que d'afficher la prose
 * du serveur. Le message reste utile dans les journaux et pour les appels directs.
 */
app.setErrorHandler((error, req, reply) => {
  if (error instanceof NotFoundError) return reply.code(404).send({ code: 'generic', error: error.message });
  if (error instanceof CrousError) {
    req.log.warn({ err: error }, 'menu Crous indisponible');
    return reply.code(502).send({ code: 'crous', error: 'Le menu du Crous est momentanément indisponible.' });
  }
  if (error instanceof AdeError) {
    req.log.warn({ err: error }, 'ADE indisponible');
    return reply.code(502).send({ code: 'ade', error: "Le serveur d'emploi du temps de l'ULCO est injoignable." });
  }
  if (typeof error.statusCode === 'number' && error.statusCode < 500) {
    return reply.code(error.statusCode).send({ code: 'generic', error: error.message });
  }
  req.log.error({ err: error }, 'erreur inattendue');
  return reply.code(500).send({ code: 'generic', error: 'Erreur interne.' });
});

await app.register(registerApi, { prefix: '/api', service, crous });
await app.register(registerPushRoutes, {
  prefix: '/api',
  service,
  store: subscriptions,
  publicKey: config.push.enabled ? config.push.publicKey : null,
});

if (config.push.enabled) {
  const sender = new PushSender(
    { publicKey: config.push.publicKey, privateKey: config.push.privateKey, subject: config.push.subject },
    subscriptions,
  );
  const notifier = new Notifier(service, subscriptions, sender, app.log, {
    tickMs: config.push.tickMs,
    pollMs: config.push.pollMs,
  });
  notifier.start();
  app.log.info({ subscriptions: subscriptions.size }, 'notifications push actives');

  app.addHook('onClose', async () => {
    notifier.stop();
    // Le registre est écrit en différé : on force l'écriture avant de rendre la main.
    subscriptions.flush();
  });
} else {
  app.log.info('notifications push désactivées (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY absentes)');
}

// En production, le serveur sert aussi le front compilé (web/dist).
const distDir = fileURLToPath(new URL('../../web/dist', import.meta.url));
if (existsSync(distDir)) {
  await app.register(fastifyStatic, { root: distDir, index: ['index.html'], cacheControl: false });

  // Les fichiers d'`assets` portent une empreinte dans leur nom : cache long.
  // `index.html` et le service worker doivent rester frais, sinon une mise à jour
  // du site ne parviendrait jamais aux téléphones qui l'ont déjà installé.
  app.addHook('onSend', async (req, reply, payload) => {
    if (req.url.startsWith('/api/')) return payload;
    reply.header('Cache-Control', req.url.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
    return payload;
  });

  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.code(404).send({ code: 'generic', error: 'Route inconnue.' });
    return reply.sendFile('index.html');
  });
} else {
  app.log.warn('web/dist absent : lancez `npm run build` pour servir le front depuis ce serveur.');
}

// Arrêt propre : un conteneur qu'on remplace ne doit pas perdre les derniers abonnements.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    app.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  });
}

await app.listen({ host: config.host, port: config.port });
