/**
 * Préférences locales. Rien ne quitte l'appareil : ni compte, ni cookie, ni suivi.
 * Chaque accès est protégé — en navigation privée, `localStorage` peut lever.
 */
const KEY = 'edt-ulco:v1';

const EMPTY = {
  department: null,
  /** Ce qu'on consulte : une classe, une salle ou un enseignant. */
  kind: 'groups',
  resourceId: null,
  resourceName: null,
  view: 'day',
  theme: 'system',
  lang: 'fr',
};

const KINDS = ['groups', 'rooms', 'teachers'];
const THEMES = ['system', 'light', 'dark'];
const LANGS = ['fr', 'en'];

export function readSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw);
    // Avant l'arrivée des salles et des enseignants, seule une classe était
    // mémorisée, sous `groupId` / `groupName`.
    const id = Number.isInteger(parsed.resourceId) ? parsed.resourceId : parsed.groupId;
    const name = parsed.resourceName ?? parsed.groupName;
    const kind = KINDS.includes(parsed.kind) ? parsed.kind : 'groups';
    const department = typeof parsed.department === 'string' ? parsed.department : null;
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
      view: parsed.view === 'week' ? 'week' : 'day',
      theme: THEMES.includes(parsed.theme) ? parsed.theme : 'system',
      lang: LANGS.includes(parsed.lang) ? parsed.lang : 'fr',
    };
  } catch {
    return { ...EMPTY };
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
