/**
 * Traductions de l'interface. Deux langues, pas de dépendance : les textes
 * tiennent dans un objet et `t()` lit une ref réactive, donc changer de langue
 * suffit à retraduire tout ce qui est affiché.
 *
 * Ce qui vient d'ADE ou du Crous (intitulés de cours, plats) n'est pas traduit :
 * ce sont des données, pas de l'interface.
 */
import { ref } from 'vue';
import { setDateLocale } from './dates.js';

export const LOCALES = [
  { id: 'fr', label: 'Français', short: 'FR' },
  { id: 'en', label: 'English', short: 'EN' },
];

const DEFAULT = 'fr';

const messages = {
  fr: {
    'app.eyebrow': 'Emploi du temps',
    'app.pickClass': 'Choisir sa classe',
    'app.today': 'Aujourd’hui',
    'app.todayBadge': 'aujourd’hui',
    'app.options': 'Options',
    'app.viewWeek': 'Vue semaine',
    'app.viewDay': 'Vue jour',
    'app.changeClass': 'Changer de classe',
    'app.subscribe': 'S’abonner au calendrier (.ics)',
    'app.refresh': 'Actualiser',
    'app.loading': 'Chargement…',
    'app.stale': 'Données enregistrées sur l’appareil — actualisation en cours…',
    'app.welcome': 'Choisis ta classe pour afficher son emploi du temps.',
    'app.theme': 'Thème',
    'app.themeSystem': 'Système',
    'app.themeLight': 'Clair',
    'app.themeDark': 'Sombre',
    'app.language': 'Langue',

    'picker.search': 'Rechercher un groupe…',
    'picker.department': 'Formation',
    'picker.loading': 'Chargement des groupes…',
    'picker.empty': 'Aucun groupe ne correspond.',
    'picker.hint': 'Le choix est mémorisé sur cet appareil.',
    'picker.expand': ({ name }) => `Déplier ${name}`,
    'picker.collapse': ({ name }) => `Replier ${name}`,

    'week.label': ({ n }) => `Semaine ${n}`,
    'week.nav': 'Semaine',
    'week.previous': 'Semaine précédente',
    'week.next': 'Semaine suivante',

    'day.aria': ({ day }) => `Cours du ${day}`,
    'day.empty': 'Aucun cours ce jour-là.',
    'day.courses': ({ n }) => `${n} cours`,
    'day.break': ({ duration }) => `${duration} de pause`,
    'card.remaining': ({ duration }) => `encore ${duration}`,

    'crous.tag': 'Crous',
    'crous.aria': 'Menu du Crous',
    'crous.fallbackName': 'Restaurant universitaire',
    'crous.fallbackHours': 'Service de 11h15 à 13h45',
    'crous.closed': 'Restaurant fermé ce jour-là.',
    'crous.loading': 'Chargement du menu…',
    'crous.unknown': 'Menu non communiqué pour ce jour.',

    'error.generic': 'Une erreur est survenue.',
    'error.network': 'Impossible de contacter le serveur.',
    'error.offline': 'Données hors ligne : impossible de contacter le serveur.',
    'error.schedule': 'Impossible de charger l’emploi du temps.',
    'error.groups': 'Impossible de charger la liste des groupes.',
    'error.ade': 'Le serveur d’emploi du temps de l’ULCO est injoignable.',
    'error.crous': 'Le menu du Crous est momentanément indisponible.',
  },

  en: {
    'app.eyebrow': 'Timetable',
    'app.pickClass': 'Pick your class',
    'app.today': 'Today',
    'app.todayBadge': 'today',
    'app.options': 'Options',
    'app.viewWeek': 'Week view',
    'app.viewDay': 'Day view',
    'app.changeClass': 'Change class',
    'app.subscribe': 'Subscribe to calendar (.ics)',
    'app.refresh': 'Refresh',
    'app.loading': 'Loading…',
    'app.stale': 'Showing data saved on this device — refreshing…',
    'app.welcome': 'Pick your class to see its timetable.',
    'app.theme': 'Theme',
    'app.themeSystem': 'System',
    'app.themeLight': 'Light',
    'app.themeDark': 'Dark',
    'app.language': 'Language',

    'picker.search': 'Search for a group…',
    'picker.department': 'Programme',
    'picker.loading': 'Loading groups…',
    'picker.empty': 'No matching group.',
    'picker.hint': 'Your choice is saved on this device.',
    'picker.expand': ({ name }) => `Expand ${name}`,
    'picker.collapse': ({ name }) => `Collapse ${name}`,

    'week.label': ({ n }) => `Week ${n}`,
    'week.nav': 'Week',
    'week.previous': 'Previous week',
    'week.next': 'Next week',

    'day.aria': ({ day }) => `Classes on ${day}`,
    'day.empty': 'No class that day.',
    'day.courses': ({ n }) => `${n} ${n === 1 ? 'class' : 'classes'}`,
    'day.break': ({ duration }) => `${duration} break`,
    'card.remaining': ({ duration }) => `${duration} left`,

    'crous.tag': 'Crous',
    'crous.aria': 'Crous menu',
    'crous.fallbackName': 'University restaurant',
    'crous.fallbackHours': 'Served 11:15 am to 1:45 pm',
    'crous.closed': 'Restaurant closed that day.',
    'crous.loading': 'Loading the menu…',
    'crous.unknown': 'No menu published for that day.',

    'error.generic': 'Something went wrong.',
    'error.network': 'Could not reach the server.',
    'error.offline': 'Offline data: could not reach the server.',
    'error.schedule': 'Could not load the timetable.',
    'error.groups': 'Could not load the list of groups.',
    'error.ade': 'The ULCO timetable server is unreachable.',
    'error.crous': 'The Crous menu is temporarily unavailable.',
  },
};

export const locale = ref(DEFAULT);

export function setLocale(value) {
  const id = LOCALES.some((l) => l.id === value) ? value : DEFAULT;
  locale.value = id;
  setDateLocale(id);
  document.documentElement.lang = id;
}

/** Traduit une clé. `params` alimente les messages qui sont des fonctions. */
export function t(key, params) {
  const entry = messages[locale.value]?.[key] ?? messages[DEFAULT][key];
  if (entry === undefined) return key;
  return typeof entry === 'function' ? entry(params ?? {}) : entry;
}

/** Message lisible pour une erreur d'API, quelle que soit la langue du serveur. */
export function errorMessage(err, fallbackKey) {
  const key = err?.code ? `error.${err.code}` : null;
  if (key && messages[DEFAULT][key] !== undefined) return t(key);
  return t(fallbackKey);
}

export function useI18n() {
  return { t, locale, setLocale };
}
