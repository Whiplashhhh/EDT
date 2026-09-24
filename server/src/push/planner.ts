import type { CourseEvent } from '../ade/ics.ts';
import { dayOf, type ScheduleChange } from './messages.ts';

/**
 * Quand prévenir, et de quoi. Ce module ne parle ni à ADE ni au réseau : il ne
 * fait que lire une liste de cours et en déduire des instants et des écarts.
 * Toute la logique horaire des notifications tient ici, et se teste seule.
 */

/** Premier cours de la journée : le rappel part une demi-heure avant. */
export const FIRST_COURSE_LEAD_MS = 30 * 60_000;
/** Cours suivants : le rappel part dix minutes avant la fin du cours précédent. */
export const BETWEEN_COURSES_LEAD_MS = 10 * 60_000;

/**
 * Un créneau de la journée. Deux cours qui commencent à la même heure (un TP
 * dédoublé en deux salles, par exemple) forment un seul créneau : on ne
 * réveille pas deux fois le téléphone pour le même moment.
 */
export interface Session {
  start: string;
  /** Fin la plus tardive du créneau. */
  end: string;
  events: CourseEvent[];
}

/** Regroupe les cours d'une même journée en créneaux, dans l'ordre. */
export function sessionsOf(events: CourseEvent[]): Session[] {
  const byStart = new Map<string, CourseEvent[]>();
  for (const event of events) {
    const list = byStart.get(event.start);
    if (list) list.push(event);
    else byStart.set(event.start, [event]);
  }
  return [...byStart.entries()]
    .map(([start, group]) => ({
      start,
      end: group.reduce((latest, e) => (e.end > latest ? e.end : latest), group[0].end),
      events: group,
    }))
    .sort((a, b) => a.start.localeCompare(b.start));
}

export interface Reminder {
  /** Instant d'envoi (ms depuis l'époque). */
  at: number;
  /** Cours annoncé : le premier du créneau. */
  event: CourseEvent;
  /** Clé de dédoublonnage : un créneau n'est annoncé qu'une fois. */
  key: string;
}

/**
 * Rappels « prochain cours » pour une liste de cours.
 *
 * La règle diffère selon la place du cours dans la journée :
 *
 * - le premier cours de la journée est annoncé 30 minutes avant son début,
 *   le temps de se lever et de venir ;
 * - les suivants sont annoncés 10 minutes avant la fin du cours précédent,
 *   c'est-à-dire pendant qu'on est encore en cours, pour savoir où aller
 *   en sortant.
 *
 * Un trou dans la journée fait donc arriver le rappel longtemps à l'avance :
 * c'est voulu, il annonce la reprise dès la fin du cours d'avant.
 */
export function remindersFor(events: CourseEvent[]): Reminder[] {
  const byDay = new Map<string, CourseEvent[]>();
  for (const event of events) {
    const day = dayOf(event.start);
    const list = byDay.get(day);
    if (list) list.push(event);
    else byDay.set(day, [event]);
  }

  const reminders: Reminder[] = [];
  for (const dayEvents of byDay.values()) {
    const sessions = sessionsOf(dayEvents);
    sessions.forEach((session, index) => {
      const start = Date.parse(session.start);
      const at =
        index === 0
          ? start - FIRST_COURSE_LEAD_MS
          : // Jamais après le début du cours annoncé : deux cours qui se chevauchent
            // ramèneraient sinon le rappel à un moment où l'on y est déjà.
            Math.min(Date.parse(sessions[index - 1].end) - BETWEEN_COURSES_LEAD_MS, start);
      reminders.push({ at, event: session.events[0], key: session.start });
    });
  }
  return reminders.sort((a, b) => a.at - b.at);
}

/**
 * Rappels à envoyer maintenant : ceux dont l'heure est passée depuis peu.
 *
 * `graceMs` rattrape un redémarrage ou une minute de retard du planificateur,
 * sans réveiller le téléphone pour un cours commencé depuis longtemps.
 */
export function dueReminders(events: CourseEvent[], now: number, graceMs: number): Reminder[] {
  return remindersFor(events).filter(
    // Un cours déjà commencé n'est plus « le prochain ».
    (r) => r.at <= now && now - r.at <= graceMs && Date.parse(r.event.start) > now,
  );
}

/** Empreinte d'un cours : tout ce dont un changement mérite d'être signalé. */
function fingerprint(event: CourseEvent): string {
  return [event.start, event.end, event.title, event.room ?? '', [...event.teachers].sort().join('|')].join('');
}

export function snapshotOf(events: CourseEvent[]): Map<string, CourseEvent> {
  return new Map(events.map((event) => [event.uid, event]));
}

/**
 * Compare deux états d'un même emploi du temps.
 *
 * Le rapprochement se fait sur l'UID iCalendar, qu'ADE conserve quand un cours
 * change de salle ou d'horaire : un cours déplacé se lit comme une modification,
 * pas comme une suppression suivie d'un ajout.
 *
 * La comparaison porte sur *toute* la fenêtre connue, et le filtrage aux deux
 * prochains jours n'intervient qu'ensuite (`changesWithin`). Comparer
 * directement deux fenêtres glissantes ferait apparaître comme « ajouté » tout
 * cours que le simple passage du temps fait entrer dans la fenêtre.
 */
export function diffSchedules(
  previous: Map<string, CourseEvent>,
  current: Map<string, CourseEvent>,
): ScheduleChange[] {
  const changes: ScheduleChange[] = [];

  for (const [uid, event] of current) {
    const before = previous.get(uid);
    if (!before) {
      changes.push({ kind: 'added', event });
      continue;
    }
    if (fingerprint(before) === fingerprint(event)) continue;
    changes.push({ kind: changeKind(before, event), event, previous: before });
  }

  for (const [uid, event] of previous) {
    if (!current.has(uid)) changes.push({ kind: 'removed', event });
  }

  return changes;
}

/** Nature principale d'une modification, de la plus structurante à la plus discrète. */
function changeKind(before: CourseEvent, after: CourseEvent): ScheduleChange['kind'] {
  if (before.start !== after.start || before.end !== after.end) return 'time';
  if ((before.room ?? '') !== (after.room ?? '')) return 'room';
  if ([...before.teachers].sort().join('|') !== [...after.teachers].sort().join('|')) return 'teachers';
  return 'other';
}

/**
 * Ne garde que les changements qui concernent les cours à venir dans les
 * `windowMs` prochaines heures — deux jours par défaut. Au-delà, un
 * réaménagement d'emploi du temps n'a pas à faire sonner un téléphone : il
 * sera vu en ouvrant l'application.
 */
export function changesWithin(changes: ScheduleChange[], now: number, windowMs: number): ScheduleChange[] {
  const horizon = now + windowMs;
  return changes
    .filter((change) => {
      // Pour une suppression, c'est l'horaire qu'avait le cours qui compte.
      const start = Date.parse(change.event.start);
      return start > now && start <= horizon;
    })
    .sort((a, b) => a.event.start.localeCompare(b.event.start));
}
