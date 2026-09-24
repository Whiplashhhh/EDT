/**
 * Préférences locales. Rien ne quitte l'appareil : ni compte, ni cookie, ni suivi.
 * Chaque accès est protégé — en navigation privée, `localStorage` peut lever.
 */
import { LOCALE_IDS, preferredLocale } from '../i18n.js';

const KEY = 'edt-ulco:v1';

const EMPTY = {
  department: null,
  /** Ce qu'on consulte : une classe, une salle ou un enseignant. */
  kind: 'groups',
  resourceId: null,
  resourceName: null,
  /**
   * Qui l'on est : sa classe, ou son nom si l'on enseigne. À la différence de
   * la ressource consultée, qui change au gré des recherches, celle-ci ne bouge
   * que si on la change explicitement. C'est elle qui décide des notifications.
   */
  identity: null,
  /** Notifications push, éteintes tant qu'on ne les a pas demandées. */
  push: { nextCourse: false, changes: false },
  view: 'day',
  theme: 'system',
};

/*
 * Réglages d'un appareil qui n'en a encore aucun. La langue n'est pas écrite en
 * dur : tant que personne n'a choisi, on affiche celle du navigateur.
 */
function empty() {
  return { ...EMPTY, lang: preferredLocale() };
}

const KINDS = ['groups', 'rooms', 'teachers'];
/** Une salle n'a pas d'élèves : on ne peut pas être une salle. */
export const IDENTITY_KINDS = ['groups', 'teachers'];
const THEMES = ['system', 'light', 'dark'];
/* La liste des langues vit dans le module de traduction : une seule source. */
const LANGS = LOCALE_IDS;

/** Relit une identité enregistrée, ou `null` si elle est incomplète. */
function readIdentity(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (!IDENTITY_KINDS.includes(raw.kind)) return null;
  if (!Number.isInteger(raw.resourceId) || typeof raw.department !== 'string') return null;
  return {
    department: raw.department,
    kind: raw.kind,
    resourceId: raw.resourceId,
    resourceName: typeof raw.resourceName === 'string' ? raw.resourceName : '',
  };
}

function readPush(raw) {
  return {
    nextCourse: raw?.nextCourse === true,
    changes: raw?.changes === true,
  };
}

export function readSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty();
    const parsed = JSON.parse(raw);
    // Avant l'arrivée des salles et des enseignants, seule une classe était
    // mémorisée, sous `groupId` / `groupName`.
    const id = Number.isInteger(parsed.resourceId) ? parsed.resourceId : parsed.groupId;
    const name = parsed.resourceName ?? parsed.groupName;
    const kind = KINDS.includes(parsed.kind) ? parsed.kind : 'groups';
    const department = typeof parsed.department === 'string' ? parsed.department : null;
    /*
     * Les versions précédentes ne mémorisaient que la ressource consultée.
     * Quand c'était une classe ou un enseignant, elle devient l'identité : il
     * n'y a aucune raison de redemander à quelqu'un ce qu'il avait déjà choisi.
     */
    const identity =
      readIdentity(parsed.identity) ??
      (IDENTITY_KINDS.includes(kind) && department && Number.isInteger(id)
        ? { department: kind === 'teachers' ? 'all' : department, kind, resourceId: id, resourceName: name ?? '' }
        : null);
    return {
      /*
       * Les enseignants se consultent toutes formations confondues : un prof
       * mémorisé sous un département précis bascule sur la vue transversale.
       * Son identifiant vient de son nom, il ne change donc pas.
       */
      department: kind === 'teachers' && department ? 'all' : department,
      kind,
      resourceId: Number.isInteger(id) ? id : null,
      resourceName: typeof name === 'string' ? name : null,
      identity,
      push: readPush(parsed.push),
      view: parsed.view === 'week' ? 'week' : 'day',
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

/** Dernier emploi du temps reçu, pour un affichage immédiat et hors ligne. */
const CACHE_KEY = 'edt-ulco:schedule:v1';

export function readCachedSchedule(department, kind, resourceId, from) {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed.department !== department || parsed.kind !== kind) return null;
    if (parsed.resourceId !== resourceId || parsed.from !== from) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeCachedSchedule(schedule) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(schedule));
  } catch {
    // Quota atteint ou stockage refusé : sans conséquence, le cache est optionnel.
  }
}
