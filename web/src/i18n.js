/**
 * Traductions de l'interface. Un fichier par langue dans `locales/`, pas de
 * dépendance : `t()` lit une ref réactive, donc changer de langue suffit à
 * retraduire tout ce qui est affiché.
 *
 * Le français et l'anglais sont dans le bundle — ce sont les langues de
 * l'établissement. Les autres sont chargées à la demande : quarante-cinq
 * catalogues dans la page d'accueil pèseraient plus que l'application elle-même.
 *
 * Ce qui vient d'ADE ou du Crous (intitulés de cours, plats) n'est pas traduit :
 * ce sont des données, pas de l'interface.
 */
import { ref } from 'vue';
import { setDateLocale } from './dates.js';
import fr from './locales/fr.js';
import en from './locales/en.js';

/*
 * `tag` sert au formatage des dates (Intl). Il est explicite plutôt que déduit
 * de l'identifiant : certaines langues n'ont pas de données Intl dans les
 * navigateurs, et il vaut mieux des dates en français qu'un repli surprise sur
 * la langue du système.
 */
export const LOCALES = [
  // Europe
  { id: 'fr', label: 'Français', region: 'europe', tag: 'fr-FR' },
  { id: 'en', label: 'English', region: 'europe', tag: 'en-GB' },
  { id: 'es', label: 'Español', region: 'europe', tag: 'es-ES' },
  { id: 'pt', label: 'Português', region: 'europe', tag: 'pt-PT' },
  { id: 'de', label: 'Deutsch', region: 'europe', tag: 'de-DE' },
  { id: 'it', label: 'Italiano', region: 'europe', tag: 'it-IT' },
  { id: 'nl', label: 'Nederlands', region: 'europe', tag: 'nl-NL' },
  { id: 'pl', label: 'Polski', region: 'europe', tag: 'pl-PL' },
  { id: 'ro', label: 'Română', region: 'europe', tag: 'ro-RO' },
  { id: 'el', label: 'Ελληνικά', region: 'europe', tag: 'el-GR' },
  { id: 'sv', label: 'Svenska', region: 'europe', tag: 'sv-SE' },
  { id: 'da', label: 'Dansk', region: 'europe', tag: 'da-DK' },
  { id: 'fi', label: 'Suomi', region: 'europe', tag: 'fi-FI' },
  { id: 'nb', label: 'Norsk', region: 'europe', tag: 'nb-NO' },
  { id: 'cs', label: 'Čeština', region: 'europe', tag: 'cs-CZ' },
  { id: 'sk', label: 'Slovenčina', region: 'europe', tag: 'sk-SK' },
  { id: 'hu', label: 'Magyar', region: 'europe', tag: 'hu-HU' },
  { id: 'bg', label: 'Български', region: 'europe', tag: 'bg-BG' },
  { id: 'hr', label: 'Hrvatski', region: 'europe', tag: 'hr-HR' },
  { id: 'sr', label: 'Српски', region: 'europe', tag: 'sr-RS' },
  { id: 'sq', label: 'Shqip', region: 'europe', tag: 'sq-AL' },
  { id: 'uk', label: 'Українська', region: 'europe', tag: 'uk-UA' },
  { id: 'ru', label: 'Русский', region: 'europe', tag: 'ru-RU' },
  { id: 'tr', label: 'Türkçe', region: 'europe', tag: 'tr-TR' },

  // Afrique
  { id: 'ar', label: 'العربية', region: 'africa', tag: 'ar', dir: 'rtl' },
  { id: 'sw', label: 'Kiswahili', region: 'africa', tag: 'sw' },
  { id: 'am', label: 'አማርኛ', region: 'africa', tag: 'am-ET' },
  { id: 'ha', label: 'Hausa', region: 'africa', tag: 'ha' },
  { id: 'af', label: 'Afrikaans', region: 'africa', tag: 'af-ZA' },
  { id: 'so', label: 'Soomaali', region: 'africa', tag: 'so' },

  // Asie et Moyen-Orient
  { id: 'zh-Hans', label: '简体中文', region: 'asia', tag: 'zh-Hans' },
  { id: 'zh-Hant', label: '繁體中文', region: 'asia', tag: 'zh-Hant' },
  { id: 'ja', label: '日本語', region: 'asia', tag: 'ja-JP' },
  { id: 'ko', label: '한국어', region: 'asia', tag: 'ko-KR' },
  { id: 'hi', label: 'हिन्दी', region: 'asia', tag: 'hi-IN' },
  { id: 'bn', label: 'বাংলা', region: 'asia', tag: 'bn-BD' },
  { id: 'ta', label: 'தமிழ்', region: 'asia', tag: 'ta-IN' },
  { id: 'ur', label: 'اردو', region: 'asia', tag: 'ur-PK', dir: 'rtl' },
  { id: 'fa', label: 'فارسی', region: 'asia', tag: 'fa-IR', dir: 'rtl' },
  { id: 'he', label: 'עברית', region: 'asia', tag: 'he-IL', dir: 'rtl' },
  { id: 'th', label: 'ไทย', region: 'asia', tag: 'th-TH' },
  { id: 'vi', label: 'Tiếng Việt', region: 'asia', tag: 'vi-VN' },
  { id: 'id', label: 'Bahasa Indonesia', region: 'asia', tag: 'id-ID' },
  { id: 'ms', label: 'Bahasa Melayu', region: 'asia', tag: 'ms-MY' },
  { id: 'tl', label: 'Tagalog', region: 'asia', tag: 'fil-PH' },
];

/** Ordre d'affichage des groupes du sélecteur. */
export const LOCALE_REGIONS = ['europe', 'africa', 'asia'];

export const LOCALE_IDS = LOCALES.map((l) => l.id);

const DEFAULT = 'fr';

const byId = new Map(LOCALES.map((l) => [l.id, l]));

/*
 * Vite transforme ce glob en une table d'imports dynamiques : chaque catalogue
 * devient un fragment séparé, téléchargé au premier usage puis mis en cache par
 * le service worker.
 */
const loaders = import.meta.glob('./locales/*.js');

/** Catalogues déjà en mémoire. Une ref : `t()` se recalcule à l'arrivée d'un nouveau. */
const loaded = ref({ fr, en });

export const locale = ref(DEFAULT);

/**
 * Change la langue de l'interface. Asynchrone : le catalogue peut rester à
 * télécharger. En cas d'échec (hors ligne, fichier absent), on garde la langue
 * courante plutôt que d'afficher une interface à moitié traduite.
 */
export async function setLocale(value) {
  const id = byId.has(value) ? value : DEFAULT;
  if (!loaded.value[id]) {
    const load = loaders[`./locales/${id}.js`];
    if (!load) return;
    try {
      const mod = await load();
      loaded.value = { ...loaded.value, [id]: mod.default };
    } catch {
      return;
    }
  }
  const meta = byId.get(id);
  locale.value = id;
  setDateLocale(meta.tag, id);
  document.documentElement.lang = id;
  document.documentElement.dir = meta.dir ?? 'ltr';
}

/** Traduit une clé. `params` alimente les messages qui sont des fonctions. */
export function t(key, params) {
  const entry = loaded.value[locale.value]?.[key] ?? fr[key];
  if (entry === undefined) return key;
  return typeof entry === 'function' ? entry(params ?? {}) : entry;
}

/** Message lisible pour une erreur d'API, quelle que soit la langue du serveur. */
export function errorMessage(err, fallbackKey) {
  const key = err?.code ? `error.${err.code}` : null;
  if (key && fr[key] !== undefined) return t(key);
  return t(fallbackKey);
}

export function useI18n() {
  return { t, locale, setLocale };
}
