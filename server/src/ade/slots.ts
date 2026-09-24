import type { CourseEvent } from './ics.ts';

/**
 * Grille horaire réelle des départements.
 *
 * ADE publie des blocs d'une heure et demie collés bout à bout, alors que les
 * cours commencent et s'arrêtent un peu à côté pour laisser passer les
 * inter-cours : le bloc ADE de 10 h 00 à 11 h 30 est en réalité un cours de
 * 10 h 10 à 11 h 35. L'écart est de quelques minutes, mais les notifications se
 * calant justement à quelques minutes des bornes, il les décalerait toutes.
 *
 * Le front applique la même grille pour afficher les cours (`web/src/slots.js`) :
 * les deux tables décrivent le même établissement et se modifient ensemble.
 */

/** Fuseau de l'établissement : ADE publie en heure de Paris. */
const TZ = 'Europe/Paris';

interface Slot {
  /** Borne publiée par ADE. */
  ade: string;
  /** Début réel du cours. */
  from: string;
  /** Fin réelle du cours. */
  to: string;
}

const SLOTS: Record<string, Slot[]> = {
  'iut-info': [
    { ade: '08:30', from: '08:30', to: '09:55' },
    { ade: '10:00', from: '10:10', to: '11:35' },
    { ade: '11:30', from: '11:35', to: '13:00' },
    { ade: '13:00', from: '13:00', to: '14:25' },
    { ade: '14:30', from: '14:30', to: '15:55' },
    { ade: '16:00', from: '16:10', to: '17:35' },
    { ade: '17:30', from: '17:35', to: '19:00' },
  ],
};

/** Fin du dernier bloc ADE de la journée : un cours peut s'y terminer. */
const DAY_END: Record<string, string> = { 'iut-info': '19:00' };

const toMinutes = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/*
 * Deux tables de traduction, et non une : une même borne ne se lit pas pareil
 * selon qu'un cours y commence ou s'y termine — à 10 h, le cours précédent
 * s'est arrêté à 9 h 55 et le suivant ne démarre qu'à 10 h 10.
 */
const GRIDS = Object.fromEntries(
  Object.entries(SLOTS).map(([id, slots]) => [
    id,
    {
      starts: new Map(slots.map((slot) => [toMinutes(slot.ade), toMinutes(slot.from)])),
      ends: new Map(slots.map((slot, i) => [toMinutes(slots[i + 1]?.ade ?? DAY_END[id]), toMinutes(slot.to)])),
    },
  ]),
);

/** Minute de la journée d'un instant, en heure de Paris (`0` à minuit). */
export function minutesOfDay(iso: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(iso));
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  // `en-GB` écrit minuit « 24:00 » : c'est le début de la journée, pas sa fin.
  return (value('hour') % 24) * 60 + value('minute');
}

/**
 * Horaires réels d'un cours publié sur la grille ADE, en minutes. Chaque borne
 * se recale de son côté : celle qui ne tombe pas sur un bloc ADE est un horaire
 * inhabituel — une soutenance jusqu'à 9 h, par exemple — et reste telle quelle.
 */
function realHours(department: string, from: number, to: number): { from: number; to: number } | null {
  const grid = GRIDS[department];
  if (!grid) return null;
  const real = { from: grid.starts.get(from) ?? from, to: grid.ends.get(to) ?? to };
  // Un cours plus court que l'inter-cours qui le précède se recalerait à l'envers.
  return real.from < real.to ? real : null;
}

const shift = (iso: string, minutes: number): string =>
  minutes ? new Date(Date.parse(iso) + minutes * 60_000).toISOString() : iso;

/**
 * Recale une liste de cours sur la grille de leur formation. Chaque cours suit
 * la sienne — celle que le service lui a attachée —, car les départements ne
 * partagent pas la même : une vue transversale (une salle, un enseignant) en
 * réunit plusieurs et ne peut pas les recaler toutes de la même façon. Un
 * département dont la grille est inconnue garde les horaires d'ADE tels quels.
 */
export function alignToSlots(department: string, events: CourseEvent[]): CourseEvent[] {
  return events.map((event) => {
    const grid = event.department ?? department;
    if (!SLOTS[grid]) return event;
    const from = minutesOfDay(event.start);
    const to = minutesOfDay(event.end) || 24 * 60;
    const real = realHours(grid, from, to);
    if (!real) return event;
    return { ...event, start: shift(event.start, real.from - from), end: shift(event.end, real.to - to) };
  });
}
