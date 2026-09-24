import type { FastifyBaseLogger } from 'fastify';
import type { AdeService } from '../ade/service.ts';
import type { CourseEvent } from '../ade/ics.ts';
import { mondayOf } from '../routes/api.ts';
import { type PushSubscription, type SubscriptionStore } from './store.ts';
import type { PushSender } from './sender.ts';
import {
  changeNotification,
  moreChangesNotification,
  nextCourseNotification,
  type Lang,
  type Notification,
  type ScheduleChange,
} from './messages.ts';
import { changesWithin, dueReminders, diffSchedules, snapshotOf } from './planner.ts';

/**
 * Le planificateur : il regarde l'heure, relit les emplois du temps suivis, et
 * envoie ce qu'il faut envoyer.
 *
 * Deux rythmes cohabitent, volontairement dissociés :
 *
 * - le *battement* (une minute) décide si un rappel « prochain cours » est dû.
 *   Il ne coûte rien : il relit une liste de cours déjà en mémoire ;
 * - le *rafraîchissement* (cinq minutes) redemande les emplois du temps à ADE
 *   et y cherche des changements. C'est le seul qui sorte sur le réseau.
 *
 * Les lier ferait une requête ADE par minute et par classe suivie, pour une
 * précision qui n'apporterait rien : ADE ne publie pas plus vite que ça.
 */

export interface NotifierOptions {
  /** Intervalle du battement, qui déclenche les rappels dus. */
  tickMs: number;
  /** Âge maximal d'un emploi du temps avant de le redemander à ADE. */
  pollMs: number;
  /** Retard maximal toléré pour un rappel (redémarrage, battement en retard). */
  graceMs: number;
  /** Au-delà, les changements d'une même classe sont résumés en une seule notification. */
  maxChangeNotifications: number;
}

export const DEFAULT_NOTIFIER_OPTIONS: NotifierOptions = {
  tickMs: 60_000,
  pollMs: 5 * 60_000,
  graceMs: 4 * 60_000,
  maxChangeNotifications: 5,
};

/** Ce que l'on retient d'une ressource suivie, d'un rafraîchissement à l'autre. */
interface Watched {
  events: CourseEvent[];
  /** Dernier état connu, indexé par UID : c'est lui qui sert de point de comparaison. */
  snapshot: Map<string, CourseEvent>;
  fetchedAt: number;
}

/** Durée pendant laquelle on se souvient d'avoir envoyé une notification. */
const SENT_MEMORY_MS = 12 * 60 * 60_000;

export class Notifier {
  readonly #service: AdeService;
  readonly #store: SubscriptionStore;
  readonly #sender: PushSender;
  readonly #options: NotifierOptions;
  readonly #log: FastifyBaseLogger;
  readonly #watched = new Map<string, Watched>();
  /** Notifications déjà parties, avec leur date : évite de sonner deux fois pour la même chose. */
  readonly #sent = new Map<string, number>();
  #timer: NodeJS.Timeout | null = null;
  #running = false;

  constructor(
    service: AdeService,
    store: SubscriptionStore,
    sender: PushSender,
    log: FastifyBaseLogger,
    options: Partial<NotifierOptions> = {},
  ) {
    this.#service = service;
    this.#store = store;
    this.#sender = sender;
    this.#log = log;
    this.#options = { ...DEFAULT_NOTIFIER_OPTIONS, ...options };
  }

  start(): void {
    if (this.#timer) return;
    this.#timer = setInterval(() => {
      // Un battement qui échoue ne doit pas arrêter les suivants.
      this.tick().catch((err) => this.#log.error({ err }, 'battement des notifications en échec'));
    }, this.#options.tickMs);
    // Le planificateur ne doit pas à lui seul garder le processus en vie.
    this.#timer.unref?.();
  }

  stop(): void {
    if (!this.#timer) return;
    clearInterval(this.#timer);
    this.#timer = null;
  }

  /**
   * Un battement. Exposé pour les tests, qui l'appellent avec une heure choisie
   * plutôt que d'attendre une minute.
   */
  async tick(now: number = Date.now()): Promise<void> {
    // Deux battements qui se chevauchent enverraient les mêmes rappels en double.
    if (this.#running) return;
    this.#running = true;
    try {
      this.#forget(now);
      const groups = this.#store.byResource();
      this.#prune(groups);

      for (const [key, subscriptions] of groups) {
        try {
          await this.#handleResource(key, subscriptions, now);
        } catch (err) {
          // ADE indisponible pour une classe : les autres continuent d'être traitées.
          this.#log.warn({ err, resource: key }, 'emploi du temps indisponible pour les notifications');
        }
      }
    } finally {
      this.#running = false;
    }
  }

  async #handleResource(key: string, subscriptions: PushSubscription[], now: number): Promise<void> {
    const { state, changes } = await this.#refresh(key, subscriptions[0], now);

    /*
     * Les changements sont calculés une fois pour la ressource, puis traduits
     * dans la langue de chaque abonné : ils décrivent le même emploi du temps.
     */
    for (const sub of subscriptions) {
      if (sub.nextCourse) await this.#sendReminders(sub, state.events, now);
      if (sub.changes && changes.length > 0) await this.#sendChanges(sub, changes, now);
    }
  }

  /** Relit l'emploi du temps si le dernier relevé a vieilli, et en déduit les changements. */
  async #refresh(
    key: string,
    sample: PushSubscription,
    now: number,
  ): Promise<{ state: Watched; changes: ScheduleChange[] }> {
    const known = this.#watched.get(key);
    if (known && now - known.fetchedAt < this.#options.pollMs) return { state: known, changes: [] };

    const from = mondayOf(new Date(now));
    const schedule =
      sample.kind === 'groups'
        ? await this.#service.schedule(sample.department, sample.resourceId, from)
        : await this.#service.facetSchedule(sample.department, sample.kind, sample.resourceId, from);

    const snapshot = snapshotOf(schedule.events);
    /*
     * Le tout premier relevé n'a rien à quoi se comparer : il sert de point de
     * départ et n'annonce rien. Sans ce garde-fou, le premier abonné d'une
     * classe recevrait la semaine entière comme autant de « cours ajoutés ».
     */
    const changes = known ? changesWithin(diffSchedules(known.snapshot, snapshot), now) : [];

    const state: Watched = { events: schedule.events, snapshot, fetchedAt: now };
    this.#watched.set(key, state);
    return { state, changes };
  }

  async #sendReminders(sub: PushSubscription, events: CourseEvent[], now: number): Promise<void> {
    for (const reminder of dueReminders(events, now, this.#options.graceMs)) {
      await this.#deliver(sub, `next:${reminder.key}`, nextCourseNotification(reminder.event, langOf(sub)), now);
    }
  }

  async #sendChanges(sub: PushSubscription, changes: ScheduleChange[], now: number): Promise<void> {
    const { maxChangeNotifications } = this.#options;
    for (const change of changes.slice(0, maxChangeNotifications)) {
      // La clé porte l'état d'arrivée : un cours déplacé deux fois prévient deux fois.
      const id = `change:${change.kind}:${change.event.uid}:${change.event.start}:${change.event.room ?? ''}`;
      await this.#deliver(sub, id, changeNotification(change, langOf(sub)), now);
    }

    const extra = changes.length - maxChangeNotifications;
    if (extra > 0) {
      const day = changes[maxChangeNotifications].event.start.slice(0, 10);
      const summary = moreChangesNotification(extra, day, langOf(sub));
      await this.#deliver(sub, `change-more:${day}:${changes.length}`, summary, now);
    }
  }

  /** Envoie une notification, sauf si la même est déjà partie vers cet abonné. */
  async #deliver(sub: PushSubscription, id: string, notification: Notification, now: number): Promise<void> {
    // L'URL d'un service de push ne contient pas d'espace : elle sépare sans ambiguïté.
    const key = `${sub.endpoint} ${id}`;
    if (this.#sent.has(key)) return;
    // Marqué avant l'envoi : une erreur réseau ne doit pas provoquer une rafale de réessais.
    this.#sent.set(key, now);
    try {
      await this.#sender.send(sub, notification);
    } catch (err) {
      this.#log.warn({ err }, 'notification push non délivrée');
    }
  }

  /** Oublie les envois anciens. */
  #forget(now: number): void {
    for (const [key, at] of this.#sent) {
      if (now - at > SENT_MEMORY_MS) this.#sent.delete(key);
    }
  }

  /** Oublie les ressources que plus personne ne suit. */
  #prune(groups: Map<string, PushSubscription[]>): void {
    for (const key of this.#watched.keys()) {
      if (!groups.has(key)) this.#watched.delete(key);
    }
  }
}

function langOf(sub: PushSubscription): Lang {
  return sub.lang === 'en' ? 'en' : 'fr';
}
