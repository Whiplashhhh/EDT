/**
 * Découpage de la journée en créneaux. ADE raisonne en blocs d'une heure et demie
 * collés bout à bout, alors que les cours commencent et s'arrêtent un peu avant,
 * pour laisser passer les inter-cours. Quand on connaît la grille d'un département,
 * on rend aux cours leurs horaires réels et on gradue la vue semaine dessus.
 *
 * Un créneau `optional` n'est utilisé qu'en cas de besoin : il ne compte pas dans
 * la plage affichée par défaut, mais reste gradué s'il porte un cours.
 */
import { minutesOfDay } from './dates.js';

const SLOTS = {
  'iut-info': [
    { ade: '08:30', from: '08:30', to: '09:55' },
    { ade: '10:00', from: '10:10', to: '11:35' },
    { ade: '11:30', from: '11:35', to: '13:00', optional: true },
    { ade: '13:00', from: '13:00', to: '14:25' },
    { ade: '14:30', from: '14:30', to: '15:55' },
    { ade: '16:00', from: '16:10', to: '17:35' },
    { ade: '17:30', from: '17:35', to: '19:00', optional: true },
  ],
};

/* Fin du dernier bloc ADE de la journée : un cours peut s'y terminer. */
const DAY_END = { 'iut-info': '19:00' };

const toMinutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Bornes de créneaux du département, triées et dédoublonnées, ou `null` si inconnues. */
export function boundariesOf(department) {
  const slots = SLOTS[department];
  if (!slots) return null;
  return [...new Set(slots.flatMap((slot) => [toMinutes(slot.from), toMinutes(slot.to)]))]
    .sort((a, b) => a - b);
}

/** Plage couverte par les créneaux ordinaires, quand la semaine affichée est vide. */
export function defaultRangeOf(department) {
  const usual = (SLOTS[department] || []).filter((slot) => !slot.optional);
  if (!usual.length) return null;
  return { from: toMinutes(usual[0].from), to: toMinutes(usual[usual.length - 1].to) };
}

/** Bornes de la grille, élargies jusqu'aux graduations qui encadrent les cours. */
export function snapRange(department, from, to) {
  const marks = boundariesOf(department);
  const floor = Math.floor(from / 60) * 60;
  const ceil = Math.ceil(to / 60) * 60;
  if (!marks) return { from: floor, to: ceil };
  return {
    from: [...marks].reverse().find((m) => m <= from) ?? floor,
    to: marks.find((m) => m >= to) ?? ceil,
  };
}

/** Instants où graduer l'axe entre `from` et `to` : les bornes de créneaux, à défaut les heures. */
export function ticksBetween(department, from, to) {
  const marks = boundariesOf(department);
  if (marks) return marks.filter((m) => m >= from && m <= to);
  const out = [];
  for (let m = from; m <= to; m += 60) out.push(m);
  return out;
}

/** Les inter-cours du département : les trous entre deux créneaux qui se suivent. */
export function breaksOf(department) {
  const slots = SLOTS[department] || [];
  return slots.slice(1)
    .map((slot, i) => ({ from: toMinutes(slots[i].to), to: toMinutes(slot.from) }))
    .filter((pause) => pause.to > pause.from);
}

/**
 * Horaires réels d'un cours publié sur la grille ADE, ou `null` si ses bornes ne
 * tombent pas sur des blocs ADE : un cours à l'horaire inhabituel — une soutenance
 * de 8h30 à 9h, par exemple — est annoncé tel quel et ne se recale sur rien.
 */
export function realHours(department, from, to) {
  const slots = SLOTS[department];
  if (!slots) return null;
  const first = slots.findIndex((slot) => toMinutes(slot.ade) === from);
  const blockEnds = [...slots.slice(1).map((slot) => slot.ade), DAY_END[department]];
  const last = blockEnds.findIndex((end) => toMinutes(end) === to);
  if (first < 0 || last < first) return null;
  return { from: toMinutes(slots[first].from), to: toMinutes(slots[last].to) };
}

const shift = (iso, minutes) =>
  minutes ? new Date(new Date(iso).getTime() + minutes * 60_000).toISOString() : iso;

/**
 * Recale les horaires d'une liste de cours sur la grille du département. Le décalage
 * ne portant que sur les minutes, il s'applique à l'instant lui-même : la date et le
 * fuseau des cours restent intacts.
 */
export function alignToSlots(department, events) {
  if (!SLOTS[department]) return events;
  return events.map((event) => {
    const from = minutesOfDay(event.start);
    const to = minutesOfDay(event.end) || 24 * 60;
    const real = realHours(department, from, to);
    if (!real) return event;
    return {
      ...event,
      start: shift(event.start, real.from - from),
      end: shift(event.end, real.to - to),
    };
  });
}
