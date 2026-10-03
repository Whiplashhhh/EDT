/**
 * Sélection de ressources, telle que l'API la comprend : `12,34-0-56` réunit
 * la ressource 12 entière et la ressource 34 privée des séances sans
 * enseignant (`0`) et de celles de l'enseignant 56. Même format que le
 * serveur (`server/src/ade/subjects.ts`), forme canonique comprise : deux
 * sélections égales s'écrivent pareil, ce qui suffit à les comparer.
 */

/** Séances qu'ADE ne rattache à aucun enseignant. */
export const NO_TEACHER = 0;
/** Ressources réunies au plus — la limite du serveur. */
export const MAX_SUBJECTS = 20;

/** Lit une sélection : `Map` ressource → enseignants écartés, ou `null` si invalide. */
export function parseSelection(raw) {
  if (typeof raw !== 'string') return null;
  const parts = raw.split(',');
  if (parts.length > MAX_SUBJECTS) return null;
  const picks = new Map();
  for (const part of parts) {
    if (!/^\d{1,8}(?:-\d{1,8})*$/.test(part)) return null;
    const [id, ...without] = part.split('-').map(Number);
    if (id <= 0) return null;
    const set = picks.get(id) ?? new Set();
    for (const teacher of without) set.add(teacher);
    picks.set(id, set);
  }
  return picks;
}

/** Écrit une sélection sous sa forme canonique. */
export function formatSelection(picks) {
  return [...picks.keys()]
    .sort((a, b) => a - b)
    .map((id) => [id, ...[...picks.get(id)].sort((a, b) => a - b)].join('-'))
    .join(',');
}
