/**
 * Ressources pédagogiques — les « matières » du BUT : R1.01, SAE5.B.00, P1.01…
 *
 * ADE ne les connaît pas comme telles : la ressource n'existe que dans
 * l'intitulé du cours, écrite à la main et sans règle commune entre
 * départements (« R1-01 Dev TPA », « GEII R1.01 An1 - TD2 »,
 * « R3.GPRH12 Pratique de la paye », « AS SAE12 Mettre en Oeuvre… »). On en
 * extrait le code, que l'on normalise pour que toutes les séances d'une même
 * ressource se retrouvent sous une seule clé.
 */
import type { CourseEvent } from './ics.ts';

/**
 * Un code de ressource : `R` ou `P` suivi d'un semestre puis d'un séparateur
 * (« R1-01 », « R5.A.05 », « P1.01 »), ou `SAE` suivi d'un numéro, séparateur
 * facultatif (« SAE11 », « SAE 1.1 », « SAE3.GC2F.02 »). Le jeton doit être
 * isolé : ni « TP2 » ni « APP » ne sont des ressources.
 */
const CODE_RE = /(?<![\p{L}\d])(?:([RP])(\d+(?:[.-][A-Z0-9]+)+)|(SA[EÉ])\s?(\d+(?:[.-]?[A-Z0-9]+)*))(?![\p{L}\d])/iu;

/** Type de séance collé au code, comme dans « R1.13TD1 ». */
const GLUED_KIND_RE = /(\d)(?:CM|TD|TP|DS)\d*$/i;

/** Segments finaux sans chiffre : « R5.02.PPP » est la ressource R5.02, intitulée PPP. */
const TRAILING_WORDS_RE = /((?:\.[A-Z]+)+)$/;

/**
 * Jetons qui ne disent rien de la matière : type de séance et sous-groupe
 * (« TD2 », « TPA », « TP1/TP2 »), évaluation, durée (« (2.5) », « 1.5 »),
 * régime (« FI »). « DS » et « CC » ne comptent que seuls : chez les GEII,
 * « CC1 » est une matière.
 */
const NOISE_RE =
  /(?<![\p{L}\d.])(?:(?:CM|TD|TP)[A-Z]?\d*(?:\/(?:CM|TD|TP)[A-Z]?\d*)*|DS|CC|EXAM|FI|\(?\d+[.,]\d+\)?)(?![\p{L}\d.])/giu;

export interface Subject {
  /** Code normalisé, ex. « R1.01 » : la clé qui réunit les séances. */
  code: string;
  /** Ce que l'intitulé dit de la matière, ex. « Dev » — vide quand il ne dit rien. */
  label: string;
}

/**
 * Code de ressource d'un cours, ou à défaut son intitulé nettoyé : une séance
 * comme « Journée anciens » ou « Portfolio » forme alors une entrée à elle seule.
 * Renvoie null quand il ne reste rien d'exploitable.
 */
export function subjectOf(event: Pick<CourseEvent, 'title' | 'subject'>): Subject | null {
  const title = event.title;
  const m = CODE_RE.exec(title);
  if (!m) {
    const label = clean(event.subject || title);
    return label ? { code: label, label: '' } : null;
  }
  const raw = m[1] ? `${m[1]}${m[2]}` : `SAE${m[4]}`;
  // « R1-01 » et « R1.01 » sont la même ressource ; un type collé n'en fait pas partie.
  let code = raw.toUpperCase().replace(/-/g, '.').replace(GLUED_KIND_RE, '$1');
  let rest = title.slice(m.index + m[0].length);
  const words = TRAILING_WORDS_RE.exec(code);
  if (words) {
    code = code.slice(0, words.index);
    rest = `${words[1].replace(/\./g, ' ')} ${rest}`;
  }
  return { code, label: clean(rest) };
}

/** Retire de l'intitulé ce qui décrit la séance plutôt que la matière. */
function clean(text: string): string {
  return text
    .replace(NOISE_RE, ' ')
    .replace(/\s+/g, ' ')
    // Deux séparateurs de suite ont perdu ce qu'ils séparaient : « CONCEVOIR - - SIN ».
    .replace(/(?:\s[-–/](?=\s))+/g, ' -')
    // Les séparateurs laissés orphelins : « An1 - », « Dev / ».
    .replace(/^[\s\-–_/:.]+|[\s\-–_/:.]+$/g, '')
    .trim();
}
