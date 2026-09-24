import type { CourseEvent } from '../ade/ics.ts';

/**
 * Textes des notifications, en français et en anglais.
 *
 * Le serveur les compose lui-même — contrairement au reste de l'interface,
 * qui se traduit dans le navigateur : au moment de l'envoi, la page n'est pas
 * ouverte. Chaque abonnement mémorise donc sa langue.
 *
 * L'interface, elle, se décline en une cinquantaine de langues. Les
 * notifications n'en connaissent que deux : qui ne lit pas le français reçoit
 * l'anglais, faute de mieux. La langue demandée est tout de même conservée
 * telle quelle, pour le jour où ces textes seront traduits eux aussi.
 *
 * Les intitulés de cours, eux, ne sont pas traduits : ce sont des données ADE.
 */

export type Lang = 'fr' | 'en';

export const LANGS: Lang[] = ['fr', 'en'];

export function isLang(value: unknown): value is Lang {
  return typeof value === 'string' && (LANGS as string[]).includes(value);
}

/** Étiquette de langue plausible (`fr`, `pt`, `zh-Hans`…), pour ne rien stocker d'arbitraire. */
const LANG_TAG = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/;

/** La langue demandée par le navigateur, ou le français si elle est illisible. */
export function readLang(value: unknown): string {
  return typeof value === 'string' && LANG_TAG.test(value) ? value : 'fr';
}

/** La langue dans laquelle une notification sera écrite. */
export function notificationLang(value: string): Lang {
  return value === 'fr' ? 'fr' : 'en';
}

/** Fuseau de l'établissement : ADE publie en heure de Paris, les notifications aussi. */
const TZ = 'Europe/Paris';

export function formatTime(iso: string, lang: Lang): string {
  return new Intl.DateTimeFormat(lang === 'fr' ? 'fr-FR' : 'en-GB', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

export function formatDay(iso: string, lang: Lang): string {
  return new Intl.DateTimeFormat(lang === 'fr' ? 'fr-FR' : 'en-GB', {
    timeZone: TZ,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(iso));
}

/** Jour calendaire d'un cours en heure de Paris (`AAAA-MM-JJ`), pour repérer le premier de la journée. */
export function dayOf(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

/** Décalage du fuseau de Paris à un instant donné (ms). */
function offsetOf(ms: number): number {
  const label = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'longOffset' })
    .formatToParts(ms)
    .find((part) => part.type === 'timeZoneName')?.value;
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(label ?? '');
  if (!match) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return (match[1] === '-' ? -minutes : minutes) * 60_000;
}

/**
 * Minuit, heure de Paris, du jour calendaire donné (`AAAA-MM-JJ`).
 *
 * Deux passes : la première applique le décalage lu à une heure approchée, la
 * seconde le corrige si cette approximation tombait de l'autre côté d'un
 * changement d'heure.
 */
export function startOfDay(day: string): number {
  const utc = Date.parse(`${day}T00:00:00.000Z`);
  let ms = utc - offsetOf(utc);
  ms = utc - offsetOf(ms);
  return ms;
}

/** Jour calendaire situé `count` jours après `day` (`AAAA-MM-JJ`). */
export function addDays(day: string, count: number): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + count * 24 * 60 * 60_000).toISOString().slice(0, 10);
}

/** Intitulé lisible d'un cours : le module, suivi du type de séance s'il est connu. */
export function courseLabel(event: CourseEvent): string {
  return event.kind ? `${event.subject} (${event.kind})` : event.subject || event.title;
}

export interface Notification {
  title: string;
  body: string;
  /** Regroupe les notifications qui se remplacent l'une l'autre sur le téléphone. */
  tag: string;
  /** Jour à ouvrir quand on touche la notification (`AAAA-MM-JJ`). */
  day: string;
}

const T = {
  fr: {
    nextCourse: 'Prochain cours',
    startsAt: (time: string) => `à ${time}`,
    room: (room: string) => `salle ${room}`,
    noRoom: 'salle non communiquée',
    added: 'Cours ajouté',
    removed: 'Cours annulé',
    movedRoom: 'Changement de salle',
    movedTime: 'Horaire modifié',
    changedStaff: 'Changement d’intervenant',
    changed: 'Cours modifié',
    arrow: '→',
    more: (n: number) => `et ${n} autre${n > 1 ? 's' : ''} changement${n > 1 ? 's' : ''}`,
    moreTitle: 'Emploi du temps modifié',
  },
  en: {
    nextCourse: 'Next class',
    startsAt: (time: string) => `at ${time}`,
    room: (room: string) => `room ${room}`,
    noRoom: 'no room given',
    added: 'Class added',
    removed: 'Class cancelled',
    movedRoom: 'Room changed',
    movedTime: 'Time changed',
    changedStaff: 'Teacher changed',
    changed: 'Class updated',
    arrow: '→',
    more: (n: number) => `and ${n} more change${n > 1 ? 's' : ''}`,
    moreTitle: 'Timetable updated',
  },
} as const;

/** « Prochain cours » : ce qui commence, quand, et où. */
export function nextCourseNotification(event: CourseEvent, lang: Lang): Notification {
  const tr = T[lang];
  const time = formatTime(event.start, lang);
  const place = event.room ? tr.room(event.room) : tr.noRoom;
  return {
    title: `${tr.nextCourse} ${tr.startsAt(time)}`,
    body: `${courseLabel(event)} · ${place}`,
    // Un seul rappel « prochain cours » à la fois sur l'écran de verrouillage.
    tag: 'edt-next',
    day: dayOf(event.start),
  };
}

export type ChangeKind = 'added' | 'removed' | 'room' | 'time' | 'teachers' | 'other';

export interface ScheduleChange {
  kind: ChangeKind;
  /** Version actuelle du cours ; pour une suppression, sa dernière version connue. */
  event: CourseEvent;
  previous?: CourseEvent;
}

export function changeNotification(change: ScheduleChange, lang: Lang): Notification {
  const tr = T[lang];
  const { event, previous } = change;
  const label = courseLabel(event);
  const room = event.room ? tr.room(event.room) : tr.noRoom;

  let title: string;
  /*
   * Le corps commence par le cours et le moment concerné, puis dit ce qui a
   * bougé. Un déplacement d'horaire fait exception : sa nouvelle date est déjà
   * au bout de la flèche, la répéter en tête n'apprendrait rien.
   */
  let body: string;
  switch (change.kind) {
    case 'added':
      title = tr.added;
      body = `${label} · ${when(event.start, lang)} · ${room}`;
      break;
    case 'removed':
      title = tr.removed;
      body = `${label} · ${when(event.start, lang)}`;
      break;
    case 'room':
      title = tr.movedRoom;
      body = `${label} · ${when(event.start, lang)} · ${previous?.room ?? '—'} ${tr.arrow} ${event.room ?? '—'}`;
      break;
    case 'time':
      title = tr.movedTime;
      body = `${label} · ${movedFrom(previous?.start ?? event.start, event.start, lang)} ${tr.arrow} ${when(event.start, lang)}`;
      break;
    case 'teachers':
      title = tr.changedStaff;
      body = `${label} · ${when(event.start, lang)} · ${event.teachers.join(', ') || '—'}`;
      break;
    default:
      title = tr.changed;
      body = `${label} · ${when(event.start, lang)} · ${room}`;
  }

  return {
    title,
    body,
    // Un identifiant par cours et par type : deux changements distincts ne s'écrasent pas.
    tag: `edt-change-${change.kind}-${event.uid}`,
    day: dayOf(event.start),
  };
}

/** « lun. 12 oct. 11:15 » : le repère complet d'un cours dans la semaine. */
function when(iso: string, lang: Lang): string {
  return `${formatDay(iso, lang)} ${formatTime(iso, lang)}`;
}

/**
 * Point de départ d'un déplacement. Tant que le cours reste le même jour,
 * l'heure suffit ; s'il change de jour, il faut le dire.
 */
function movedFrom(from: string, to: string, lang: Lang): string {
  return dayOf(from) === dayOf(to) ? formatTime(from, lang) : when(from, lang);
}

/** Quand les changements sont trop nombreux, une seule notification les résume. */
export function moreChangesNotification(count: number, day: string, lang: Lang): Notification {
  const tr = T[lang];
  return { title: tr.moreTitle, body: tr.more(count), tag: 'edt-change-more', day };
}
