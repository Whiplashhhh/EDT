import webpush from 'web-push';
import type { SubscriptionStore, PushSubscription } from './store.ts';
import type { Notification } from './messages.ts';

/**
 * Envoi des notifications au service de push du navigateur (FCM, Mozilla, Apple…).
 *
 * Le protocole (VAPID pour s'identifier, RFC 8291 pour chiffrer le contenu de
 * bout en bout) est délégué à `web-push` : le service de push relaie un message
 * qu'il ne peut pas lire, et seul le navigateur abonné le déchiffre.
 */

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
  /** Contact de l'exploitant, exigé par VAPID : `mailto:` ou `https:`. */
  subject: string;
}

/** Durée pendant laquelle le service de push garde le message si le téléphone est éteint. */
const TTL_SECONDS = 20 * 60;

export class PushSender {
  readonly #keys: VapidKeys;
  readonly #store: SubscriptionStore;

  constructor(keys: VapidKeys, store: SubscriptionStore) {
    this.#keys = keys;
    this.#store = store;
  }

  /**
   * Envoie une notification à un abonné.
   *
   * Un abonnement peut mourir sans prévenir : l'utilisateur désinstalle
   * l'application, révoque l'autorisation, change de téléphone. Le service de
   * push répond alors 404 ou 410, et c'est le seul signal qu'on aura — on
   * supprime l'abonnement plutôt que de le réessayer indéfiniment.
   *
   * @returns `true` si la notification est partie, `false` si l'abonnement est mort.
   */
  async send(sub: PushSubscription, notification: Notification): Promise<boolean> {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: sub.keys },
        JSON.stringify(notification),
        {
          TTL: TTL_SECONDS,
          urgency: 'normal',
          vapidDetails: {
            subject: this.#keys.subject,
            publicKey: this.#keys.publicKey,
            privateKey: this.#keys.privateKey,
          },
        },
      );
      return true;
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        this.#store.remove(sub.endpoint);
        return false;
      }
      // 429, 5xx, réseau : incident passager côté service de push. La notification
      // suivante repartira ; on ne supprime surtout pas un abonnement encore valable.
      throw error;
    }
  }
}

/**
 * Fabrique une paire de clés VAPID. Utilisé par `npm run vapid` pour
 * initialiser une installation : les clés sont ensuite fournies par
 * l'environnement et ne changent plus — les changer invaliderait tous les
 * abonnements existants.
 */
export function generateVapidKeys(): { publicKey: string; privateKey: string } {
  return webpush.generateVAPIDKeys();
}
