/**
 * Préférences locales. Rien ne quitte l'appareil : ni compte, ni cookie, ni suivi.
 * Chaque accès est protégé — en navigation privée, `localStorage` peut lever.
 */
import { LOCALE_IDS, preferredLocale } from '../i18n.js';
import { formatSelection, parseSelection } from '../subjects.js';

const KEY = 'edt-ulco:v1';

/*
 * Génération des abonnements. La monter remet tous les interrupteurs de
 * notification à zéro sur chaque appareil : sans elle, l'application se
 * réabonnerait d'elle-même à la prochaine ouverture, même après avoir vidé les
 * abonnements côté serveur. On la monte en même temps qu'on vide ce registre.
 */
const PUSH_EPOCH = 2;

const EMPTY = {
  department: null,
  /** Ce qu'on consulte : une classe, une salle, un enseignant ou des ressources. */
  kind: 'groups',
  /** Un entier — ou, pour les ressources, la sélection écrite comme l'API la lit (`12,34-0`). */
  resourceId: null,
  resourceName: null,
  /**
   * Qui l'on est : sa classe, son nom si l'on enseigne, ou les ressources
   * qu'on assure quand ADE ne connaît pas son nom — le cas d'un vacataire. À la différence de
   * la ressource consultée, qui change au gré des recherches, celle-ci ne bouge
   * que si on la change explicitement. C'est elle qui décide des notifications.
   */
  identity: null,
  /** Notifications push, éteintes tant qu'on ne les a pas demandées. */
  push: { nextCourse: false, changes: false, menu: false, epoch: PUSH_EPOCH },
  /**
   * Second emploi du temps affiché à côté du premier, en vue jour : n'importe
   * quelle classe, salle ou enseignant, de n'importe quelle formation.
   */
  compare: null,
  view: 'day',
  /**
   * Vrai dès qu'on a choisi soi-même entre jour et semaine. Tant que ce n'est
   * pas le cas, la vue suit la taille de l'écran (voir `defaultView`).
   */
  viewChosen: false,
  /** Menu du Crous dans la vue jour. Affiché par défaut ; on le masque si l'on n'y mange jamais. */
  crousMenu: true,
  theme: 'system',
};

/*
 * Réglages d'un appareil qui n'en a encore aucun. La langue n'est pas écrite en
 * dur : tant que personne n'a choisi, on affiche celle du navigateur.
 */
function empty() {
  return { ...EMPTY, view: defaultView(), lang: preferredLocale() };
}

/*
 * Vue de qui n'a pas encore choisi : la semaine entière tient sur un ordinateur
 * ou une tablette, le jour seul sur un téléphone. La hauteur écarte un
 * téléphone tenu à l'horizontale.
 */
function defaultView() {
  try {
    return window.matchMedia('(min-width: 700px) and (min-height: 500px)').matches ? 'week' : 'day';
  } catch {
    return 'day';
  }
}

const KINDS = ['groups', 'rooms', 'teachers', 'subjects'];
/** Une salle n'a pas d'élèves : on ne peut pas être une salle. */
export const IDENTITY_KINDS = ['groups', 'teachers', 'subjects'];
const THEMES = ['system', 'light', 'dark'];
/* La liste des langues vit dans le module de traduction : une seule source. */
const LANGS = LOCALE_IDS;

/**
 * Relit l'identifiant de ce qu'on consulte : un entier, ou pour les ressources
 * une sélection, remise sous sa forme canonique. `null` s'il ne correspond pas
 * au type.
 */
function readResourceId(kind, raw) {
  if (kind !== 'subjects') return Number.isInteger(raw) ? raw : null;
  const picks = parseSelection(raw);
  return picks ? formatSelection(picks) : null;
}

/** Relit une identité enregistrée, ou `null` si elle est incomplète. */
function readIdentity(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (!IDENTITY_KINDS.includes(raw.kind)) return null;
  const resourceId = readResourceId(raw.kind, raw.resourceId);
  if (resourceId === null || typeof raw.department !== 'string') return null;
  return {
    department: raw.department,
    kind: raw.kind,
    resourceId,
    resourceName: typeof raw.resourceName === 'string' ? raw.resourceName : '',
  };
}

/** Relit la ressource comparée, ou `null` si elle est incomplète. */
function readCompare(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (!KINDS.includes(raw.kind)) return null;
  const resourceId = readResourceId(raw.kind, raw.resourceId);
  if (resourceId === null || typeof raw.department !== 'string') return null;
  return {
    department: raw.department,
    kind: raw.kind,
    resourceId,
    resourceName: typeof raw.resourceName === 'string' ? raw.resourceName : '',
  };
}

/**
 * Relit la vue. Avant `viewChosen`, « jour » était enregistré d'office : seule
 * « semaine » trahit un vrai choix. Une comparaison en cours n'existe qu'en vue
 * jour, on ne la fait pas disparaître.
 */
function readView(raw, compare) {
  const viewChosen = raw.viewChosen === true || raw.view === 'week';
  if (viewChosen) return { view: raw.view === 'week' ? 'week' : 'day', viewChosen };
  return { view: compare ? 'day' : defaultView(), viewChosen };
}

function readPush(raw) {
  if (raw?.epoch !== PUSH_EPOCH) return { ...EMPTY.push };
  return {
    nextCourse: raw?.nextCourse === true,
    changes: raw?.changes === true,
    menu: raw?.menu === true,
    epoch: PUSH_EPOCH,
  };
}

export function readSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty();
    const parsed = JSON.parse(raw);
    // Avant l'arrivée des salles et des enseignants, seule une classe était
    // mémorisée, sous `groupId` / `groupName`.
    const kind = KINDS.includes(parsed.kind) ? parsed.kind : 'groups';
    const id = readResourceId(kind, parsed.resourceId ?? parsed.groupId);
    const name = parsed.resourceName ?? parsed.groupName;
    const department = typeof parsed.department === 'string' ? parsed.department : null;
    /*
     * Les versions précédentes ne mémorisaient que la ressource consultée.
     * Quand c'était une classe ou un enseignant, elle devient l'identité : il
     * n'y a aucune raison de redemander à quelqu'un ce qu'il avait déjà choisi.
     */
    const identity =
      readIdentity(parsed.identity) ??
      (IDENTITY_KINDS.includes(kind) && department && Number.isInteger(id)
        ? { department: kind === 'groups' ? department : 'all', kind, resourceId: id, resourceName: name ?? '' }
        : null);
    const compare = readCompare(parsed.compare);
    return {
      /*
       * Les salles et les enseignants se consultent toutes formations
       * confondues : une ressource mémorisée sous un département précis bascule
       * sur la vue transversale. Son identifiant vient de son nom, il ne change
       * donc pas.
       */
      department: kind !== 'groups' && department ? 'all' : department,
      kind,
      resourceId: id,
      resourceName: typeof name === 'string' ? name : null,
      identity,
      push: readPush(parsed.push),
      compare,
      ...readView(parsed, compare),
      crousMenu: parsed.crousMenu !== false,
      theme: THEMES.includes(parsed.theme) ? parsed.theme : 'system',
      lang: LANGS.includes(parsed.lang) ? parsed.lang : preferredLocale(),
    };
  } catch {
    return empty();
  }
}

export function writeSettings(settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Stockage indisponible : l'application reste utilisable, sans mémoire.
  }
}

/**
 * Dernier emploi du temps reçu, pour un affichage immédiat et hors ligne. Chaque
 * emplacement garde le sien : celui qu'on compare au sien ne doit pas l'écraser.
 */
const CACHE_KEY = 'edt-ulco:schedule:v1';
const cacheKey = (slot) => (slot ? `${CACHE_KEY}:${slot}` : CACHE_KEY);

export function readCachedSchedule(department, kind, resourceId, from, slot) {
  try {
    const raw = localStorage.getItem(cacheKey(slot));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed.department !== department || parsed.kind !== kind) return null;
    if (parsed.resourceId !== resourceId || parsed.from !== from) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeCachedSchedule(schedule, slot) {
  try {
    localStorage.setItem(cacheKey(slot), JSON.stringify(schedule));
  } catch {
    // Quota atteint ou stockage refusé : sans conséquence, le cache est optionnel.
  }
}
