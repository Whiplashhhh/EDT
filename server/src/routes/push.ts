import type { FastifyInstance } from 'fastify';
import type { AdeService } from '../ade/service.ts';
import { mondayOf } from './api.ts';
import type { PushSubscription, SubscriptionStore } from '../push/store.ts';
import { isLang } from '../push/messages.ts';

/**
 * Abonnement et désabonnement aux notifications push.
 *
 * Le navigateur produit un abonnement — une URL opaque chez son service de
 * push, plus deux clés de chiffrement — et nous le confie avec la ressource à
 * suivre. C'est la seule route de l'API qui écrive quoi que ce soit.
 */

const DEPARTMENT_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
/** Clés publiées par le navigateur : base64url, longueur bornée par le format. */
const KEY_RE = /^[A-Za-z0-9_-]{16,256}$/;
const MAX_ENDPOINT_LENGTH = 1024;
/** Seules une classe et un enseignant ont des notifications : une salle n'a pas d'élèves. */
const SUBSCRIBABLE_KINDS = ['groups', 'teachers'] as const;

function bad(message: string): Error {
  return Object.assign(new Error(message), { statusCode: 400 });
}

interface SubscribeBody {
  subscription?: { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  department?: unknown;
  kind?: unknown;
  resourceId?: unknown;
  resourceName?: unknown;
  nextCourse?: unknown;
  changes?: unknown;
  lang?: unknown;
}

/**
 * Vérifie la forme de l'abonnement envoyé par le navigateur.
 *
 * L'URL est imposée en `https` : c'est ce que produisent tous les services de
 * push, et cela ferme la porte à une URL forgée qui ferait du serveur un relais
 * vers un hôte arbitraire.
 */
function parseEndpoint(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_ENDPOINT_LENGTH) {
    throw bad('Abonnement push invalide.');
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw bad('Abonnement push invalide.');
  }
  if (url.protocol !== 'https:') throw bad('Abonnement push invalide.');
  return raw;
}

function parseKey(raw: unknown): string {
  if (typeof raw !== 'string' || !KEY_RE.test(raw)) throw bad('Clés de chiffrement invalides.');
  return raw;
}

function parseKind(raw: unknown): 'groups' | 'teachers' {
  if (raw === 'groups' || raw === 'teachers') return raw;
  throw bad('Seule une classe ou un enseignant peut recevoir des notifications.');
}

function parseFlag(raw: unknown): boolean {
  if (typeof raw !== 'boolean') throw bad('Option de notification invalide.');
  return raw;
}

export interface PushRoutesOptions {
  service: AdeService;
  store: SubscriptionStore;
  /** Clé publique VAPID à publier, ou `null` si les notifications sont désactivées. */
  publicKey: string | null;
}

export async function registerPushRoutes(app: FastifyInstance, opts: PushRoutesOptions): Promise<void> {
  const { service, store, publicKey } = opts;

  /** Refuse la requête tant que l'installation n'a pas de clés VAPID. */
  function requireEnabled(): string {
    if (!publicKey) {
      throw Object.assign(new Error('Les notifications ne sont pas activées sur ce serveur.'), {
        statusCode: 503,
        code: 'push-disabled',
      });
    }
    return publicKey;
  }

  /*
   * Le front interroge cette route avant d'afficher les réglages : sans clé
   * publique, il n'a même pas à proposer les notifications.
   */
  app.get('/push/config', async (_req, reply) => {
    reply.header('Cache-Control', 'public, max-age=300');
    return { enabled: Boolean(publicKey), publicKey, kinds: SUBSCRIBABLE_KINDS };
  });

  /**
   * Enregistre — ou met à jour — un abonnement. Le navigateur rappelle cette
   * route à chaque ouverture : c'est ainsi que suivent un changement de classe,
   * de langue ou d'options, et que se renouvelle un abonnement expiré.
   */
  app.post<{ Body: SubscribeBody }>('/push/subscribe', async (req, reply) => {
    requireEnabled();
    const body = req.body ?? {};

    const endpoint = parseEndpoint(body.subscription?.endpoint);
    const keys = {
      p256dh: parseKey(body.subscription?.keys?.p256dh),
      auth: parseKey(body.subscription?.keys?.auth),
    };

    const kind = parseKind(body.kind);
    const department = String(body.department ?? '');
    if (!DEPARTMENT_RE.test(department)) throw bad('Département invalide.');
    const resourceId = Number(body.resourceId);
    if (!Number.isInteger(resourceId) || resourceId <= 0 || resourceId > 10_000_000) {
      throw bad('Identifiant de ressource invalide.');
    }

    /*
     * La ressource est vérifiée auprès d'ADE avant d'être enregistrée : on ne
     * garde pas un abonnement vers une classe qui n'existe pas, et le nom
     * affiché vient de la source plutôt que du client.
     */
    const resourceName =
      kind === 'groups'
        ? (await service.findGroup(department, resourceId)).name
        : await teacherName(service, department, resourceId);

    const subscription: PushSubscription = {
      endpoint,
      keys,
      department,
      kind,
      resourceId,
      resourceName,
      nextCourse: parseFlag(body.nextCourse),
      changes: parseFlag(body.changes),
      lang: isLang(body.lang) ? body.lang : 'fr',
      updatedAt: new Date().toISOString(),
    };

    if (!store.save(subscription)) {
      throw Object.assign(new Error('Trop d’abonnements enregistrés sur ce serveur.'), { statusCode: 503 });
    }

    reply.code(204);
  });

  /** Coupe les notifications. Le navigateur appelle aussi cette route s'il perd l'autorisation. */
  app.post<{ Body: { endpoint?: unknown } }>('/push/unsubscribe', async (req, reply) => {
    const endpoint = parseEndpoint(req.body?.endpoint);
    store.remove(endpoint);
    // Désabonner deux fois n'est pas une erreur : le résultat voulu est atteint.
    reply.code(204);
  });
}

/** Nom d'un enseignant dans l'annuaire transversal — sert aussi à vérifier qu'il existe. */
async function teacherName(service: AdeService, department: string, resourceId: number): Promise<string> {
  const directory = await service.directory(department, 'teachers', mondayOf(new Date()));
  const entry = directory.entries.find((e) => e.id === resourceId);
  if (!entry) throw Object.assign(new Error('Enseignant inconnu.'), { statusCode: 404 });
  return entry.name;
}
