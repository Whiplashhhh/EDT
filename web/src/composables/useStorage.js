/**
 * Préférences locales. Rien ne quitte l'appareil : ni compte, ni cookie, ni suivi.
 * Chaque accès est protégé — en navigation privée, `localStorage` peut lever.
 */
const KEY = 'edt-ulco:v1';

const EMPTY = { department: null, groupId: null, groupName: null, view: 'day', theme: 'system', lang: 'fr' };

const THEMES = ['system', 'light', 'dark'];
const LANGS = ['fr', 'en'];

export function readSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw);
    return {
      department: typeof parsed.department === 'string' ? parsed.department : null,
      groupId: Number.isInteger(parsed.groupId) ? parsed.groupId : null,
      groupName: typeof parsed.groupName === 'string' ? parsed.groupName : null,
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

export function readCachedSchedule(department, groupId, from) {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed.department !== department || parsed.groupId !== groupId || parsed.from !== from) return null;
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
