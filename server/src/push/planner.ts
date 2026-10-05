import type { CourseEvent } from '../ade/ics.ts';
import { minutesOfDay } from '../ade/slots.ts';
import { addDays, dayOf, startOfDay, type ScheduleChange } from './messages.ts';

/**
 * Quand prévenir, et de quoi. Ce module ne parle ni à ADE ni au réseau : il ne
 * fait que lire une liste de cours et en déduire des instants et des écarts.
 * Toute la logique horaire des notifications tient ici, et se teste seule.
 */

/** Reprise après une pause : le rappel part une demi-heure avant le cours. */
export const FIRST_COURSE_LEAD_MS = 30 * 60_000;
/** Cours enchaîné : le rappel part cinq minutes avant la fin du cours précédent. */
export const BETWEEN_COURSES_LEAD_MS = 5 * 60_000;
/** Menu du midi : annoncé cinq minutes avant la fin du dernier cours de la matinée. */
export const MENU_LEAD_MS = 5 * 60_000;

/**
 * Fenêtre où se termine le dernier cours d'avant le déjeuner, en minutes depuis
 * minuit, heure de Paris.
 *
 * Elle sert à reconnaître la pause du midi sans supposer la grille d'un
 * département : un cours qui s'arrête entre 11 h et 14 h est le dernier avant
 * le repas, un cours qui s'arrête à 9 h 55 ne l'est pas.
 */
export const LUNCH_END_WINDOW = { from: 11 * 60, to: 14 * 60 };

/**
 * Fenêtre où commence le premier cours d'une journée qui démarre après le
 * déjeuner, en minutes depuis minuit, heure de Paris.
 *
 * Elle reconnaît celui qui arrive pour l'après-midi et peut passer au
 * restaurant en chemin. Un cours qui ne commence qu'à 16 h n'en fait pas
 * partie : on ne déjeune pas trois heures avant d'arriver.
 */
export const LUNCH_ARRIVAL_WINDOW = { from: 11 * 60, to: 14 * 60 + 30 };

/** Heure d'envoi du menu à qui n'a cours que l'après-midi (minutes depuis minuit). */
export const MENU_ARRIVAL_TIME = 11 * 60;

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
 * La règle diffère selon ce qui précède le cours :
 *
 * - un cours enchaîné derrière un autre est annoncé 5 minutes avant la fin de
 *   celui-ci, c'est-à-dire pendant qu'on y est encore, pour savoir où aller en
 *   sortant ;
 * - un cours qu'une vraie pause précède — le premier de la journée, celui qui
 *   reprend après le déjeuner ou après un trou — est annoncé 30 minutes avant
 *   son début.
 *
 * Le second cas se reconnaît à l'attente : au-delà d'une demi-heure de battement,
 * annoncer le cours dès la fin du précédent donnerait l'impression qu'il est
 * imminent alors qu'il reste une heure à attendre. Le rappel part donc au moment
 * où il faut se remettre en route, pas au moment où l'on quitte la salle.
 */
export function remindersFor(events: CourseEvent[]): Reminder[] {
  const reminders: Reminder[] = [];
  for (const dayEvents of byDay(events).values()) {
    const sessions = sessionsOf(dayEvents);
    sessions.forEach((session, index) => {
      const start = Date.parse(session.start);
      const previousEnd = index === 0 ? null : Date.parse(sessions[index - 1].end);
      const at =
        previousEnd === null || start - previousEnd > FIRST_COURSE_LEAD_MS
          ? start - FIRST_COURSE_LEAD_MS
          : // Jamais après le début du cours annoncé : deux cours qui se chevauchent
            // ramèneraient sinon le rappel à un moment où l'on y est déjà.
            Math.min(previousEnd - BETWEEN_COURSES_LEAD_MS, start);
      reminders.push({ at, event: session.events[0], key: session.start });
    });
  }
  return reminders.sort((a, b) => a.at - b.at);
}

/** Cours d'une même journée calendaire, regroupés. */
function byDay(events: CourseEvent[]): Map<string, CourseEvent[]> {
  const map = new Map<string, CourseEvent[]>();
  for (const event of events) {
    const day = dayOf(event.start);
    const list = map.get(day);
    if (list) list.push(event);
    else map.set(day, [event]);
  }
  return map;
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

/** Annonce du menu du restaurant universitaire, un jour donné. */
export interface MenuReminder {
  /** Instant d'envoi (ms depuis l'époque). */
  at: number;
  /** Jour concerné (`AAAA-MM-JJ`), qui sert aussi de clé de dédoublonnage. */
  day: string;
  /**
   * Formation des cours de ce jour-là : elle dit sur quel campus on déjeune.
   * Un enseignant qui intervient dans deux villes reçoit ainsi, chaque jour,
   * le menu de celle où il se trouve.
   */
  department?: string;
}

/**
 * Rappels « menu du midi » : un par journée où l'on est au département autour
 * du repas, c'est-à-dire où un cours précède le déjeuner ou le suit.
 *
 * Le cours d'avant le déjeuner se reconnaît à son heure de fin plutôt qu'à sa
 * place dans la journée : c'est le dernier à s'arrêter dans la fenêtre du midi.
 * Le menu part alors cinq minutes avant sa fin. Une matinée qui s'achève à
 * 11 h 35 comme une journée qui court jusqu'à 13 h donnent donc le bon moment.
 *
 * Une journée qui ne commence qu'après le repas n'a pas de cours à qui
 * s'accrocher : le menu part à 11 h, à temps pour décider où déjeuner avant de
 * venir. Et une journée où l'on n'est là ni avant ni après — rien du tout, ou
 * une matinée finie à 9 h 55 — n'annonce rien : on ne déjeune pas au
 * restaurant un jour où l'on n'y passe pas.
 */
export function menuRemindersFor(events: CourseEvent[]): MenuReminder[] {
  const reminders: MenuReminder[] = [];
  for (const [day, dayEvents] of byDay(events)) {
    const sessions = sessionsOf(dayEvents);

    let before: Session | null = null;
    for (const session of sessions) {
      const end = minutesOfDay(session.end);
      if (end < LUNCH_END_WINDOW.from || end > LUNCH_END_WINDOW.to) continue;
      if (!before || session.end > before.end) before = session;
    }
    const department = dayEvents.find((event) => event.department)?.department;
    if (before) {
      reminders.push({ at: Date.parse(before.end) - MENU_LEAD_MS, day, department });
      continue;
    }

    // Pas de cours avant le repas : reste à savoir si l'on arrive pour l'après-midi.
    const after = sessions.some((session) => {
      const start = minutesOfDay(session.start);
      return start >= LUNCH_ARRIVAL_WINDOW.from && start <= LUNCH_ARRIVAL_WINDOW.to;
    });
    if (after) reminders.push({ at: startOfDay(day) + MENU_ARRIVAL_TIME * 60_000, day, department });
  }
  return reminders.sort((a, b) => a.at - b.at);
}

/** Rappels « menu du midi » à envoyer maintenant. */
export function dueMenuReminders(events: CourseEvent[], now: number, graceMs: number): MenuReminder[] {
  return menuRemindersFor(events).filter((r) => r.at <= now && now - r.at <= graceMs);
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
 * La comparaison porte sur *toute* la fenêtre connue, et le filtrage à la
 * journée concernée n'intervient qu'ensuite (`splitChanges`).
 * Comparer directement deux fenêtres glissantes ferait apparaître comme
 * « ajouté » tout cours que le simple passage du temps fait entrer dans la
 * fenêtre.
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
 * Heure à partir de laquelle les changements du lendemain sont annoncés, en
 * minutes depuis minuit, heure de Paris.
 *
 * Dans la journée, seul ce qui bouge aujourd'hui fait sonner le téléphone :
 * apprendre à 10 h qu'un cours de demain change de salle ne sert à rien, et
 * l'information serait oubliée d'ici là. Le soir, on prépare le lendemain.
 */
export const TOMORROW_CHANGES_FROM = 20 * 60;

/**
 * Fin de la fenêtre des notifications de changement, heure de Paris : la fin
 * de la journée en cours, ou celle de demain à partir de 20 h.
 *
 * Une durée fixe ferait varier la portée selon l'heure d'envoi ; une fin de
 * journée se raisonne comme on lit un emploi du temps.
 */
export function changeHorizon(now: number): number {
  const iso = new Date(now).toISOString();
  const evening = minutesOfDay(iso) >= TOMORROW_CHANGES_FROM;
  return startOfDay(addDays(dayOf(iso), evening ? 2 : 1));
}

/**
 * Limite au-delà de laquelle un changement n'est jamais annoncé : la fin de la
 * journée de demain. Plus loin, un réaménagement d'emploi du temps n'a pas à
 * faire sonner un téléphone : il sera vu en ouvrant l'application.
 */
function watchHorizon(now: number): number {
  return startOfDay(addDays(dayOf(new Date(now).toISOString()), 2));
}

/**
 * Premier horaire encore à venir que touche un changement. Un cours déplacé
 * concerne son ancien créneau autant que le nouveau : avancé d'aujourd'hui à
 * demain, il libère un créneau d'aujourd'hui, et c'est aujourd'hui qu'il faut
 * le savoir. Pour une suppression, c'est l'horaire qu'avait le cours qui compte.
 */
function nextStartOf(change: ScheduleChange, now: number): number | null {
  const starts = [change.event.start, change.previous?.start]
    .filter((start): start is string => start !== undefined)
    .map((start) => Date.parse(start))
    .filter((start) => start > now);
  return starts.length > 0 ? Math.min(...starts) : null;
}

/**
 * Trie des changements selon le moment de les annoncer :
 *
 * - `due` : à annoncer maintenant, car ils touchent un cours d'ici la fin de
 *   la fenêtre (`changeHorizon`) ;
 * - `deferred` : ils touchent un cours de demain, mais il n'est pas encore
 *   20 h. Le planificateur les garde de côté et les annonce le soir venu.
 *
 * Le reste — cours passés, ou au-delà de demain — est abandonné.
 */
export function splitChanges(
  changes: ScheduleChange[],
  now: number,
): { due: ScheduleChange[]; deferred: ScheduleChange[] } {
  const horizon = changeHorizon(now);
  const limit = watchHorizon(now);
  const due: ScheduleChange[] = [];
  const deferred: ScheduleChange[] = [];
  for (const change of changes) {
    const start = nextStartOf(change, now);
    if (start === null || start >= limit) continue;
    (start < horizon ? due : deferred).push(change);
  }
  due.sort((a, b) => a.event.start.localeCompare(b.event.start));
  return { due, deferred };
}

/** Changements à annoncer maintenant (voir `splitChanges`). */
export function changesWithin(changes: ScheduleChange[], now: number): ScheduleChange[] {
  return splitChanges(changes, now).due;
}

/**
 * Ajoute de nouveaux changements à ceux qui attendent encore d'être annoncés.
 *
 * Un même cours modifié deux fois avant 20 h ne doit donner qu'une
 * notification, qui va de l'état d'origine — le dernier que l'abonné a pu
 * voir — à l'état actuel. Et un cours qui revient à son état d'origine
 * n'annonce plus rien.
 */
export function mergeChanges(older: ScheduleChange[], newer: ScheduleChange[]): ScheduleChange[] {
  const byUid = new Map<string, ScheduleChange | null>(older.map((change) => [change.event.uid, change]));
  for (const change of newer) {
    const first = byUid.get(change.event.uid);
    byUid.set(change.event.uid, first ? combine(first, change) : change);
  }
  return [...byUid.values()].filter((change): change is ScheduleChange => change !== null);
}

/** Les deux changements successifs d'un même cours, résumés en un seul (ou en rien). */
function combine(first: ScheduleChange, then: ScheduleChange): ScheduleChange | null {
  // L'état d'avant le premier changement ; `null` si le cours n'existait pas.
  const origin = first.kind === 'added' ? null : first.kind === 'removed' ? first.event : (first.previous ?? null);
  if (then.kind === 'removed') return origin ? { kind: 'removed', event: origin } : null;
  if (!origin) return { kind: 'added', event: then.event };
  if (fingerprint(origin) === fingerprint(then.event)) return null;
  return { kind: changeKind(origin, then.event), event: then.event, previous: origin };
}
