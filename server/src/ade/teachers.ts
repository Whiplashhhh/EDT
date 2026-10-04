/**
 * Reconnaissance des enseignants dans la description d'un cours ADE.
 *
 * ADE y range pêle-mêle les groupes, les intervenants et tout ce que les
 * gestionnaires tapent à la main : « (Blender) », « ** Correction du DS ** »,
 * « + 40 minutes pour 1/3 temps », « Promo L1 Info »… Seul un nom de personne
 * devient un enseignant ; le reste est gardé tel quel comme remarque.
 *
 * La forme canonique est celle d'ADE : « NOM Prénom ». Les autres s'y ramènent
 * autant que la ligne le permet :
 *  - « Line PERON », « Mme Laura BALLOY »  → « PERON Line », « BALLOY Laura » ;
 *  - « S.Boivin », « F. LARUELLE »         → « BOIVIN S. », « LARUELLE F. » ;
 *  - « Mme Boivin », « M. Basse »          → « BOIVIN », « BASSE ».
 * Ces deux dernières formes, partielles, sont rattachées au nom complet à
 * l'échelle de l'annuaire (voir `teacherAliases`), qui seul les connaît tous.
 */

/** Sigles et mots courants qui, en capitales, ne sont pas des noms de famille. */
const NOT_SURNAMES = new Set([
  'BTP', 'BUT', 'CAPEPS', 'CC', 'CDL', 'CM', 'DS', 'DU', 'LEA', 'LP', 'LV', 'OBLIGATOIRE', 'PAR', 'PASS',
  'PFI', 'PLANNING', 'PROMO', 'SAE', 'SALLE', 'SELON', 'TD', 'TP', 'UO',
]);

/** Premiers mots d'une ligne « Mot MOT » qui ne sont pas des prénoms : « Atelier MLP », « Visite STEP ». */
const NOT_FIRST_NAMES = new Set([
  'amphi', 'anglais', 'atelier', 'attention', 'certification', 'commun', 'contrôle', 'controle', 'cours',
  'espagnol', 'évaluation', 'evaluation', 'examen', 'groupe', 'gpe', 'liste', 'option', 'parcours', 'presence',
  'présence', 'promo', 'réalisation', 'report', 'salle', 'séance', 'sortie', 'spécialité', 'tutorat', 'visite',
]);

/** Civilités : elles disent qu'il s'agit d'une personne, sans faire partie de son nom. */
const CIVILITY_RE = /^(?:M\.\s*|M\\;\s*|(?:Mr|Mme|Mlle|Melle)\.?\s+|(?:Monsieur|Madame)\s+)/iu;
/** Ce qui annonce un intervenant sans en faire partie. */
const LEAD_RE = /^(?:\+\s*|avec\s+|séance assurée par\s+|enseignante?\s*:\s*|intervenante?\s+)/iu;
/** Ce qui sépare deux intervenants, ou un intervenant d'une précision. */
const SEPARATOR_RE = /\s+et\s+|\s*,\s*|\s*\/\s*|\s+-\s+|\s+:\s+|\s*\(/giu;

/** NOM : des capitales (accents compris), apostrophes et tirets ; jamais de minuscule ASCII. */
const isUpperWord = (w: string): boolean => /^\p{Lu}[\p{L}'’-]*$/u.test(w) && !/[a-z]/.test(w) && w.length >= 2;

/** Prénom : une capitale puis des minuscules, par segment — « Jean-Philippe », « LoreleÏ ». */
const isCapWord = (w: string): boolean =>
  w.split('-').every((part) => /^\p{Lu}(?:[\p{Ll}'’]|[À-Þ])+$/u.test(part));

const isSurname = (w: string): boolean => isUpperWord(w) && !NOT_SURNAMES.has(w);

/** Nettoie les décorations autour d'une ligne : « - Line PERON - », « ** DS ** ». */
function trimDecorations(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\((?:titulaire|vacataire)\)/giu, '')
    .replace(/^[\s\-–*+•.,;:]+|[\s\-–*+•.,;:]+$/gu, '')
    .trim();
}

/**
 * Le nom canonique d'un morceau de ligne, ou `null` si ce n'est pas une personne.
 * `announced` : la ligne commençait par « Séance assurée par », « Avec », « + »…
 */
export function personOf(raw: string, announced = false): string | null {
  let text = trimDecorations(raw);
  if (LEAD_RE.test(text) || /^\s*\+/.test(raw)) announced = true;
  text = text.replace(LEAD_RE, '');
  const civility = CIVILITY_RE.test(text);
  text = text.replace(CIVILITY_RE, '').trim();
  if (!text) return null;
  const words = text.split(' ');

  // « NOM Prénom » : la forme d'ADE.
  const upper = words.findIndex((w) => !isUpperWord(w));
  if (upper > 0 && words.slice(0, upper).every(isSurname) && words.slice(upper).every(isCapWord)) {
    return words.join(' ');
  }

  // « Prénom NOM », à remettre dans l'ordre.
  const cap = words.findIndex((w) => !isCapWord(w));
  if (
    cap > 0 &&
    cap <= 2 &&
    words.slice(cap).every(isSurname) &&
    !NOT_FIRST_NAMES.has(words[0].toLowerCase()) &&
    (civility || words.slice(cap).some((w) => w.length >= 3))
  ) {
    return [...words.slice(cap), ...words.slice(0, cap)].join(' ');
  }

  // « S.Boivin », « F. LARUELLE » : une initiale et un nom.
  const initial = /^(\p{Lu})\.\s*(.+)$/u.exec(text);
  if (initial) {
    const surname = initial[2].split(' ');
    if (surname.length <= 2 && surname.every((w) => isUpperWord(w) || isCapWord(w))) {
      return `${surname.join(' ').toUpperCase()} ${initial[1]}.`;
    }
  }

  // « Séance assurée par Antoine Marsac » : annoncé ainsi, « Prénom Nom » est bien une personne.
  if (announced && (words.length === 2 || words.length === 3) && words.every(isCapWord)) {
    return `${words.slice(1).join(' ').toUpperCase()} ${words[0]}`;
  }

  // « Mme Boivin » : un nom seul ne vaut que précédé d'une civilité.
  if (civility && words.length <= 2 && words.every((w) => isUpperWord(w) || isCapWord(w))) {
    return text.toUpperCase();
  }
  return null;
}

/**
 * Les enseignants d'une ligne de description, dans l'ordre où elle les cite,
 * et ce qui reste de la ligne une fois les noms ôtés. Une ligne qui ne
 * commence pas par un nom est une remarque entière : « M1 EGEDD - L.Hocquez »
 * nomme un groupe, pas l'enseignant de chacun de ses cours.
 */
export function readTeachers(line: string): { teachers: string[]; note: string | null } {
  const cleaned = trimDecorations(line.replace(/\t/g, ' '));
  const announced = LEAD_RE.test(cleaned) || /^\s*\+/.test(line);
  const text = cleaned.replace(LEAD_RE, '');
  const separators = new RegExp(SEPARATOR_RE.source, SEPARATOR_RE.flags);
  const teachers: string[] = [];
  let consumed = 0;
  for (;;) {
    const match = separators.exec(text);
    const end = match ? match.index : text.length;
    const person = personOf(text.slice(consumed, end), announced);
    if (!person) break;
    teachers.push(person);
    if (!match) {
      consumed = text.length;
      break;
    }
    // Une parenthèse ouvre une précision, pas un autre nom.
    if (match[0].includes('(')) {
      consumed = match.index;
      break;
    }
    consumed = match.index + match[0].length;
  }
  if (teachers.length === 0) return { teachers, note: line.trim() };
  return { teachers, note: trimDecorations(text.slice(consumed)) || null };
}

/** Clé de comparaison d'un nom : sans accents ni casse. */
const fold = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Sépare « NOM COMPOSÉ Prénom » en nom et prénom. */
function splitName(name: string): { surname: string; firstName: string } {
  const words = name.split(' ');
  const cut = words.findIndex((w) => !isUpperWord(w));
  return { surname: words.slice(0, cut).join(' '), firstName: words.slice(cut).join(' ') };
}

/** Un nom complet, par opposition à « BASSE » ou « BOIVIN S. ». */
const isFullName = (name: string): boolean => /\p{Ll}/u.test(name) && !/ \p{Lu}\.$/u.test(name);

/**
 * Rattache les formes partielles au nom complet qu'elles désignent, quand il
 * n'y en a qu'un : « BASSE » à « BASSE David », « BOIVIN S. » à
 * « BOIVIN Severine ». Une remarque qui n'est qu'un nom complet écrit
 * autrement — « Zoé Descharles » — s'y rattache aussi.
 *
 * `names` : tous les enseignants lus ; `notes` : toutes les remarques.
 * Renvoie, pour chaque forme rattachée, le nom complet qu'elle désigne.
 */
export function teacherAliases(names: Iterable<string>, notes: Iterable<string> = []): Map<string, string> {
  const unique = new Set(names);
  const bySurname = new Map<string, string[]>();
  const byName = new Map<string, string>();
  for (const name of unique) {
    if (!isFullName(name)) continue;
    // Un nom composé se cite souvent par son premier mot : « Mme Longuet » pour « LONGUET VANNOUQUE Julie ».
    const surname = fold(splitName(name).surname);
    for (const key of new Set([surname, surname.split(' ')[0]])) {
      bySurname.set(key, [...(bySurname.get(key) ?? []), name]);
    }
    byName.set(fold(name), name);
  }

  const aliases = new Map<string, string>();
  for (const name of unique) {
    if (isFullName(name)) continue;
    const initial = / (\p{Lu})\.$/u.exec(name)?.[1];
    const surname = fold(initial ? name.slice(0, -3) : name);
    const candidates = (bySurname.get(surname) ?? []).filter(
      (full) => !initial || splitName(full).firstName.startsWith(initial),
    );
    if (candidates.length === 1) aliases.set(name, candidates[0]);
  }

  for (const note of new Set(notes)) {
    const words = trimDecorations(note).split(' ');
    if (words.length < 2 || words.length > 6) continue;
    // Les deux ordres : « Zoé Descharles » comme « Descharles Zoé ».
    for (let cut = 0; cut < words.length; cut += 1) {
      const match = byName.get(fold([...words.slice(cut), ...words.slice(0, cut)].join(' ')));
      if (match) {
        aliases.set(note, match);
        break;
      }
    }
  }
  return aliases;
}
