import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { FastifyReply, FastifyRequest } from 'fastify';
import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import compress from '@fastify/compress';
import fastifyStatic from '@fastify/static';
import { loadConfig } from './config.ts';
import { AdeService, NotFoundError } from './ade/service.ts';
import { CrousService, CrousError } from './crous/service.ts';
import { AdeError } from './ade/gwt.ts';
import { readSnapshot, writeSnapshot } from './ade/snapshot.ts';
import { mondayOf, registerApi } from './routes/api.ts';
import { describeShared, injectPreview, previewText, readSharedPage } from './share/preview.ts';
import { registerPushRoutes } from './routes/push.ts';
import { registerFeedbackRoutes } from './routes/feedback.ts';
import { smtpMailer } from './feedback/mailer.ts';
import { SubscriptionStore } from './push/store.ts';
import { PushSender } from './push/sender.ts';
import { Notifier } from './push/notifier.ts';

const config = loadConfig();
const service = new AdeService(config);
// La dernière copie d'ADE, d'avant le redémarrage : de quoi servir même si ADE ne répond pas.
service.restore(readSnapshot(config.adeCachePath));
// Le menu suit le campus de la formation : c'est ADE qui sait où elle est.
const crous = new CrousService(config, (department) => service.cityOf(department));

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
const OWN_CODE_RE = /^(push|feedback)-[a-z-]+$/;

app.setErrorHandler((error, req, reply) => {
  // Les routes qui écrivent portent leurs propres codes (`feedback-send`, `push-disabled`…).
  const own = typeof error.code === 'string' && OWN_CODE_RE.test(error.code) ? error.code : null;
  if (own && typeof error.statusCode === 'number') {
    return reply.code(error.statusCode).send({ code: own, error: error.message });
  }
  if (error.statusCode === 429) {
    return reply.code(429).send({ code: 'rate-limit', error: 'Trop de requêtes, réessayez plus tard.' });
  }
  if (error instanceof NotFoundError) return reply.code(404).send({ code: 'generic', error: error.message });
  if (error instanceof CrousError) {
    req.log.warn({ err: error }, 'menu Crous indisponible');
    return reply.code(503).send({ code: 'crous', error: 'Le menu du Crous est momentanément indisponible.' });
  }
  if (error instanceof AdeError) {
    req.log.warn({ err: error }, 'ADE indisponible');
    // 503 et non 502 : Cloudflare remplace les 502 par sa propre page, et le
    // front perdrait le code qui lui fait dire que c'est l'ULCO qui ne répond pas.
    return reply.code(503).send({ code: 'ade', error: "Le serveur d'emploi du temps de l'ULCO est injoignable." });
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

await app.register(registerFeedbackRoutes, {
  prefix: '/api',
  send: config.feedback.enabled ? smtpMailer(config.feedback) : null,
  describeDepartment: async (id) => {
    const { cities, departments } = await service.departments();
    const dept = departments.find((d) => d.id === id);
    if (!dept) return null;
    return { label: dept.label, city: cities.find((c) => c.id === dept.city)?.label ?? null };
  },
});
app.log.info(config.feedback.enabled ? 'formulaire de contact actif' : 'formulaire de contact désactivé (SMTP non configuré)');

if (config.push.enabled) {
  const sender = new PushSender(
    { publicKey: config.push.publicKey, privateKey: config.push.privateKey, subject: config.push.subject },
    subscriptions,
  );
  const notifier = new Notifier(service, crous, subscriptions, sender, app.log, {
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

  /*
   * Une semaine ou une journée partagée reçoit son propre aperçu : c'est lui
   * que WhatsApp ou Messenger affichent sous le lien. Le nom vient du cache
   * d'ADE ; s'il tarde, l'aperçu s'en passe plutôt que de faire attendre.
   */
  const indexHtml = readFileSync(fileURLToPath(new URL('../../web/dist/index.html', import.meta.url)), 'utf8');
  const PREVIEW_WAIT_MS = 1500;
  const sendIndex = async (req: FastifyRequest, reply: FastifyReply) => {
    const page = readSharedPage(req.query as Record<string, unknown>);
    if (!page) return reply.sendFile('index.html');
    let timer: NodeJS.Timeout | undefined;
    const about = await Promise.race([
      describeShared(service, page, mondayOf(new Date())).catch(() => null),
      new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), PREVIEW_WAIT_MS); }),
    ]);
    clearTimeout(timer);
    const html = injectPreview(indexHtml, { ...previewText(page, about ?? { name: null }), path: req.url });
    return reply.type('text/html; charset=utf-8').send(html);
  };
  app.get('/', sendIndex);

  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.code(404).send({ code: 'generic', error: 'Route inconnue.' });
    return sendIndex(req, reply);
  });
} else {
  app.log.warn('web/dist absent : lancez `npm run build` pour servir le front depuis ce serveur.');
}

/*
 * Sauvegarde des données d'ADE, quand elles ont changé : toutes les cinq
 * minutes, et à l'arrêt.
 */
let savedRevision = service.revision;
const saveAdeCache = async (): Promise<void> => {
  const revision = service.revision;
  if (revision === savedRevision) return;
  try {
    await writeSnapshot(config.adeCachePath, service.snapshot());
    savedRevision = revision;
  } catch (err) {
    app.log.warn({ err }, 'sauvegarde du cache ADE en échec');
  }
};
setInterval(() => void saveAdeCache(), 5 * 60 * 1000).unref();
app.addHook('onClose', saveAdeCache);

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

// L'arbre de toute l'ULCO se parcourt en arrière-plan, une fois le serveur à
// l'écoute : le premier visiteur n'a pas à l'attendre, et un ADE injoignable
// au démarrage n'empêche pas de servir le reste.
service.warmUp().then(
  () => app.log.info('Arbre ADE chargé'),
  (err: unknown) => app.log.warn({ err }, "Préchargement de l'arbre ADE interrompu"),
);
