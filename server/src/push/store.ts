import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Registre des abonnements aux notifications push.
 *
 * C'est la seule donnée que le service écrit sur disque. Le reste de
 * l'application est sans état : un emploi du temps est public et se
 * recalcule, un abonnement push ne se recalcule pas — le navigateur ne
 * le redonne qu'une fois, à l'instant où l'utilisateur accepte.
 *
 * Ce qui est conservé se limite au strict nécessaire pour envoyer la
 * notification : l'URL opaque du service de push, les deux clés de
 * chiffrement qu'il impose, la ressource suivie et la langue d'affichage.
 * Aucun nom, aucune adresse, aucune adresse IP.
 */

/** Ce qu'un abonné suit : sa classe, ou son nom s'il enseigne. */
export interface PushIdentity {
  department: string;
  /** `groups` (une classe) ou `teachers` (un enseignant). Jamais `rooms` : une salle n'a pas d'élèves. */
  kind: 'groups' | 'teachers';
  resourceId: number;
  resourceName: string;
}

export interface PushSubscription extends PushIdentity {
  /** URL opaque fournie par le navigateur ; sert aussi de clé primaire. */
  endpoint: string;
  keys: { p256dh: string; auth: string };
  /** Annonce du cours suivant. */
  nextCourse: boolean;
  /** Changement d'emploi du temps dans les deux jours à venir. */
  changes: boolean;
  lang: string;
  updatedAt: string;
}

/** Clé du groupe d'abonnés qui suivent la même ressource : un seul emploi du temps à charger pour tous. */
export function resourceKey(identity: PushIdentity): string {
  return `${identity.department}:${identity.kind}:${identity.resourceId}`;
}

const MAX_SUBSCRIPTIONS = 20_000;

export class SubscriptionStore {
  readonly #path: string;
  readonly #byEndpoint = new Map<string, PushSubscription>();
  /** Écriture différée : un abonnement qui change n'entraîne pas une écriture par appel. */
  #flushTimer: NodeJS.Timeout | null = null;
  #dirty = false;

  constructor(path: string) {
    this.#path = path;
    this.#load();
  }

  #load(): void {
    let raw: string;
    try {
      raw = readFileSync(this.#path, 'utf8');
    } catch {
      // Premier démarrage : le fichier n'existe pas encore, ce n'est pas une erreur.
      return;
    }
    try {
      const parsed = JSON.parse(raw) as { subscriptions?: unknown };
      if (!Array.isArray(parsed.subscriptions)) return;
      for (const entry of parsed.subscriptions) {
        const sub = entry as PushSubscription;
        if (typeof sub?.endpoint === 'string' && sub.keys?.p256dh && sub.keys?.auth) {
          this.#byEndpoint.set(sub.endpoint, sub);
        }
      }
    } catch {
      // Fichier illisible : on repart d'un registre vide plutôt que de refuser de démarrer.
      // Les abonnements perdus se recréent à la prochaine ouverture de l'application.
    }
  }

  get size(): number {
    return this.#byEndpoint.size;
  }

  all(): PushSubscription[] {
    return [...this.#byEndpoint.values()];
  }

  get(endpoint: string): PushSubscription | undefined {
    return this.#byEndpoint.get(endpoint);
  }

  /** Abonnements regroupés par ressource suivie : évite de charger dix fois le même emploi du temps. */
  byResource(): Map<string, PushSubscription[]> {
    const map = new Map<string, PushSubscription[]>();
    for (const sub of this.#byEndpoint.values()) {
      if (!sub.nextCourse && !sub.changes) continue;
      const key = resourceKey(sub);
      const list = map.get(key);
      if (list) list.push(sub);
      else map.set(key, [sub]);
    }
    return map;
  }

  /** Crée ou met à jour un abonnement. La clé est l'URL du service de push. */
  save(sub: PushSubscription): boolean {
    if (!this.#byEndpoint.has(sub.endpoint) && this.#byEndpoint.size >= MAX_SUBSCRIPTIONS) return false;
    this.#byEndpoint.set(sub.endpoint, sub);
    this.#schedule();
    return true;
  }

  remove(endpoint: string): boolean {
    const removed = this.#byEndpoint.delete(endpoint);
    if (removed) this.#schedule();
    return removed;
  }

  #schedule(): void {
    this.#dirty = true;
    if (this.#flushTimer) return;
    this.#flushTimer = setTimeout(() => {
      this.#flushTimer = null;
      this.flush();
    }, 2_000);
    this.#flushTimer.unref?.();
  }

  /** Écriture atomique : on écrit à côté puis on renomme, pour ne jamais laisser un fichier tronqué. */
  flush(): void {
    if (!this.#dirty) return;
    this.#dirty = false;
    const body = JSON.stringify({ subscriptions: this.all() });
    const temp = `${this.#path}.tmp`;
    try {
      mkdirSync(dirname(this.#path), { recursive: true });
      writeFileSync(temp, body, { encoding: 'utf8', mode: 0o600 });
      renameSync(temp, this.#path);
    } catch {
      // Disque plein ou volume en lecture seule : les abonnements restent en mémoire
      // et fonctionnent jusqu'au redémarrage. Mieux vaut ça qu'un service arrêté.
      this.#dirty = true;
    }
  }
}
