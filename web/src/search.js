/**
 * Recherche d'une classe dans l'arbre d'ADE. Le nom d'un groupe ne dit souvent
 * pas sa formation — « BUT2-TD1 » ne contient pas « INFO », que seul le
 * dossier parent porte : on cherche donc dans tout le chemin
 * (« IUT INFO › BUT2 › BUT2-TD1 »), mot à mot et dans n'importe quel ordre.
 */

/** Mots d'un texte, sans casse ni accents : « BUT2-TD1 » donne but2, td1. */
export function words(text) {
  return (
    text
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? []
  );
}

const isDigit = (c) => c >= '0' && c <= '9';
/** Entre « but » et « 2 », ou « 2 » et « td » : la frontière d'un mot collé. */
const boundary = (text, i) => i === 0 || i === text.length || isDigit(text[i]) !== isDigit(text[i - 1]);

/**
 * Débuts possibles d'une recherche dans un mot : son début, et chaque passage
 * d'une lettre à un chiffre. « geii2td1 » se cherche par « geii », « 2td1 » ou
 * « td1 » ; « 12 » ne se trouve pas par « 2 ».
 */
function starts(text) {
  return words(text).flatMap((word) => [...word].flatMap((_, i) => (boundary(word, i) ? [word.slice(i)] : [])));
}

/**
 * Qualité d'un mot cherché dans un texte : 2 s'il y forme un mot entier
 * (« but » dans « BUT2 »), 1 s'il n'en est que le début (« info » dans
 * « INFORMATIQUE »), 0 s'il n'y est pas.
 */
function quality(units, term) {
  let best = 0;
  for (const unit of units) {
    if (!unit.startsWith(term)) continue;
    if (boundary(unit, term.length)) return 2;
    best = 1;
  }
  return best;
}

/**
 * Groupes dont le chemin contient tous les mots cherchés. Viennent d'abord les
 * correspondances exactes — « info 2 » préfère « IUT INFO › BUT2 » à
 * « ING2 - Informatique » —, puis celles qui se lisent le plus haut dans
 * l'arbre : « IUT INFO › BUT2 » et ses TD passent avant un groupe de TP
 * d'EILCO dont seul le nom contient « 2 ». À niveau égal, le groupe où la
 * correspondance s'arrête précède ses sous-groupes.
 *
 * @param {{ name: string, parents: string[] }[]} groups
 */
export function searchGroups(groups, query) {
  const terms = words(query);
  if (!terms.length) return [];
  const found = [];
  groups.forEach((group, order) => {
    const levels = [...group.parents, group.name];
    const units = [];
    let cover = -1;
    for (const [i, level] of levels.entries()) {
      units.push(...starts(level));
      if (terms.every((term) => quality(units, term))) {
        cover = i;
        break;
      }
    }
    if (cover < 0) return;
    const path = starts(levels.join(' '));
    found.push({ group, exact: terms.reduce((sum, term) => sum + quality(path, term), 0), cover, depth: levels.length, order });
  });
  return found
    .sort((a, b) => b.exact - a.exact || a.cover - b.cover || a.depth - b.depth || a.order - b.order)
    .map((f) => f.group);
}
