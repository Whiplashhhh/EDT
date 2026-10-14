import type { MoveConfig } from '../config.ts';
import { notificationLang, type Notification } from './messages.ts';
import type { PushSubscription, SubscriptionStore } from './store.ts';

/**
 * Dernière notification des abonnés de l'ancien domaine.
 *
 * Leur abonnement appartient au service worker de l'ancienne adresse : il ne
 * se met plus à jour, puisque ses pages redirigent, et doublerait celui qu'ils
 * créeraient sur la nouvelle. On les prévient donc une fois, puis on les
 * oublie : ils réactivent leurs notifications sur la nouvelle adresse.
 */

/** Gardée quatre jours par le service de push : un téléphone éteint le week-end la reçoit lundi. */
const FAREWELL_TTL_SECONDS = 4 * 24 * 60 * 60;
/** Heures de Paris pendant lesquelles on prévient : pas de notification en pleine nuit. */
const DAYTIME = { from: 8, to: 20 };

export interface FarewellSender {
  send(sub: PushSubscription, notification: Notification, opts?: { ttl?: number }): Promise<boolean>;
}

/** Un abonnement d'avant le changement d'adresse, ou arrivé par l'ancien domaine. */
export function isOldSubscription(sub: PushSubscription, move: MoveConfig): boolean {
  return !sub.host || move.from.includes(sub.host);
}

/** Court : sur iPhone, une notification ne se déplie pas. */
export function farewellNotification(lang: string, to: string): Notification {
  const host = new URL(to).host;
  return notificationLang(lang) === 'fr'
    ? { title: 'EDT ULCO a déménagé', body: `Nouvelle adresse : ${host}. Touchez ici, puis réactivez vos notifications.`, tag: 'demenagement', day: '' }
    : { title: 'EDT ULCO has moved', body: `New address: ${host}. Tap here, then turn your notifications back on.`, tag: 'demenagement', day: '' };
}

function parisHour(now: Date): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: 'numeric', hourCycle: 'h23' }).format(now));
}

/**
 * Prévient les anciens abonnés, une seule fois chacun : l'abonnement est retiré
 * après l'essai, qu'il ait abouti ou non. Ne fait rien hors des heures de jour.
 */
export async function announceMove(
  store: SubscriptionStore,
  sender: FarewellSender,
  move: MoveConfig,
  now = new Date(),
): Promise<{ sent: number; failed: number }> {
  const result = { sent: 0, failed: 0 };
  const hour = parisHour(now);
  if (hour < DAYTIME.from || hour >= DAYTIME.to) return result;

  for (const sub of store.all().filter((s) => isOldSubscription(s, move))) {
    try {
      if (await sender.send(sub, farewellNotification(sub.lang, move.to), { ttl: FAREWELL_TTL_SECONDS })) result.sent++;
      else result.failed++;
    } catch {
      result.failed++;
    }
    store.remove(sub.endpoint);
  }
  return result;
}
