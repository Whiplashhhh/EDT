/**
 * Découpage de la journée en créneaux. ADE ne publie que les horaires des cours ;
 * certains départements, eux, suivent une grille fixe. Quand on la connaît, la vue
 * semaine se gradue dessus plutôt que d'heure en heure : les traits tombent alors
 * sur le début et la fin réels des cours, et non à côté.
 *
 * Un créneau `optional` n'est utilisé qu'en cas de besoin : il ne compte pas dans
 * la plage affichée par défaut, mais reste gradué s'il porte un cours.
 */
import { formatMinutes } from './dates.js';

const SLOTS = {
  'iut-info': [
    { from: '08:30', to: '09:55' },
    { from: '10:10', to: '11:35' },
    { from: '11:35', to: '13:00', optional: true },
    { from: '13:00', to: '14:25' },
    { from: '14:30', to: '15:55' },
    { from: '16:10', to: '17:35' },
    { from: '17:35', to: '19:00', optional: true },
  ],
};

/** Deux graduations plus rapprochées que cela ne peuvent pas porter chacune leur heure. */
const LABEL_MIN_GAP = 12;

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

/**
 * Graduations de l'axe entre `from` et `to`. `label` est vide quand la précédente
 * est trop proche pour être lisible : le trait reste, l'heure passe à la suivante.
 */
export function ticksBetween(department, from, to) {
  const marks = boundariesOf(department);
  if (!marks) {
    const out = [];
    for (let m = from; m <= to; m += 60) out.push({ at: m, label: formatMinutes(m) });
    return out;
  }
  const inRange = marks.filter((m) => m >= from && m <= to);
  return inRange.map((at, i) => ({
    at,
    label: inRange[i + 1] - at < LABEL_MIN_GAP ? '' : formatMinutes(at),
  }));
}
