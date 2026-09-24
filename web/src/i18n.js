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
    'app.eyebrow.groups': 'Emploi du temps',
    'app.eyebrow.rooms': 'Salle',
    'app.eyebrow.teachers': 'Enseignant',
    'app.pickResource': 'Choisir sa classe',
    'app.today': 'Aujourd’hui',
    'app.todayBadge': 'aujourd’hui',
    'app.options': 'Options',
    'app.viewWeek': 'Vue semaine',
    'app.viewDay': 'Vue jour',
    'app.changeResource': 'Classe, salle ou enseignant',
    'app.subscribe': 'Exporter vers mon agenda',
    'app.refresh': 'Actualiser',
    'app.loading': 'Chargement…',
    'app.stale': 'Données enregistrées sur l’appareil — actualisation en cours…',
    'app.welcome': 'Choisis une classe, une salle ou un enseignant pour afficher son emploi du temps.',
    'app.theme': 'Thème',
    'app.themeSystem': 'Système',
    'app.themeLight': 'Clair',
    'app.themeDark': 'Sombre',
    'app.language': 'Langue',
    'app.changeIdentity': 'Mon calendrier',
    'app.backToMine': ({ name }) => `Revenir à ${name}`,
    'app.viewingOther': 'Vous consultez un autre emploi du temps',

    'gate.title': 'Qui es-tu ?',
    'gate.intro':
      'Choisis ta classe pour commencer. Si tu enseignes, choisis ton nom : c’est ton emploi du temps qui s’affichera.',
    'gate.why': 'Ce choix reste sur cet appareil. Il sert d’emploi du temps par défaut et décide des notifications.',
    'gate.action': 'Choisir ma classe ou mon nom',

    'push.section': 'Notifications',
    'push.nextCourse': 'Prochain cours',
    'push.nextCourseHint': '30 min avant le premier cours du jour, 10 min avant la fin du cours précédent.',
    'push.changes': 'Changements',
    'push.changesHint': 'Salle, horaire, ajout ou annulation, pour aujourd’hui et demain.',
    'push.unsupported': 'Ce navigateur ne sait pas recevoir de notifications.',
    'push.unavailable': 'Les notifications ne sont pas activées sur ce serveur.',
    'push.denied': 'Les notifications sont bloquées. Autorise-les dans les réglages du navigateur.',
    'push.failed': 'Impossible d’activer les notifications pour le moment.',
    'push.brave': 'Brave bloque les notifications par défaut. Ouvre brave://settings/privacy, active « Use Google services for push messaging », puis recharge cette page.',

    'picker.mode': 'Que consulter',
    'picker.kind.groups': 'Classes',
    'picker.kind.rooms': 'Salles',
    'picker.kind.teachers': 'Enseignants',
    'picker.search.groups': 'Rechercher un groupe…',
    'picker.search.rooms': 'Rechercher une salle…',
    'picker.search.teachers': 'Rechercher un enseignant…',
    'picker.courses': ({ n }) => `${n} cours`,
    'picker.department': 'Formation',
    'picker.loading': 'Chargement…',
    'picker.empty': 'Aucun résultat.',
    'picker.hint': 'Le choix est mémorisé sur cet appareil.',
    'picker.identityHint': 'Modifiable à tout moment depuis le menu ⋯.',
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
    'error.rooms': 'Impossible de charger la liste des salles.',
    'error.teachers': 'Impossible de charger la liste des enseignants.',
    'error.ade': 'Le serveur d’emploi du temps de l’ULCO est injoignable.',
    'error.crous': 'Le menu du Crous est momentanément indisponible.',
  },

  en: {
    'app.eyebrow.groups': 'Timetable',
    'app.eyebrow.rooms': 'Room',
    'app.eyebrow.teachers': 'Teacher',
    'app.pickResource': 'Pick your class',
    'app.today': 'Today',
    'app.todayBadge': 'today',
    'app.options': 'Options',
    'app.viewWeek': 'Week view',
    'app.viewDay': 'Day view',
    'app.changeResource': 'Class, room or teacher',
    'app.subscribe': 'Export to my calendar',
    'app.refresh': 'Refresh',
    'app.loading': 'Loading…',
    'app.stale': 'Showing data saved on this device — refreshing…',
    'app.welcome': 'Pick a class, a room or a teacher to see its timetable.',
    'app.theme': 'Theme',
    'app.themeSystem': 'System',
    'app.themeLight': 'Light',
    'app.themeDark': 'Dark',
    'app.language': 'Language',
    'app.changeIdentity': 'My calendar',
    'app.backToMine': ({ name }) => `Back to ${name}`,
    'app.viewingOther': 'You are viewing another timetable',

    'gate.title': 'Who are you?',
    'gate.intro':
      'Pick your class to get started. If you teach, pick your name instead — your own timetable will be shown.',
    'gate.why': 'This stays on your device. It is your default timetable, and it decides what you get notified about.',
    'gate.action': 'Pick my class or my name',

    'push.section': 'Notifications',
    'push.nextCourse': 'Next class',
    'push.nextCourseHint': '30 min before the first class of the day, 10 min before the previous one ends.',
    'push.changes': 'Changes',
    'push.changesHint': 'Room, time, added or cancelled classes, for today and tomorrow.',
    'push.unsupported': 'This browser cannot receive notifications.',
    'push.unavailable': 'Notifications are not enabled on this server.',
    'push.denied': 'Notifications are blocked. Allow them in your browser settings.',
    'push.failed': 'Could not turn notifications on right now.',
    'push.brave': 'Brave blocks notifications by default. Open brave://settings/privacy, turn on “Use Google services for push messaging”, then reload this page.',

    'picker.mode': 'What to show',
    'picker.kind.groups': 'Classes',
    'picker.kind.rooms': 'Rooms',
    'picker.kind.teachers': 'Teachers',
    'picker.search.groups': 'Search for a group…',
    'picker.search.rooms': 'Search for a room…',
    'picker.search.teachers': 'Search for a teacher…',
    'picker.courses': ({ n }) => `${n} ${n === 1 ? 'class' : 'classes'}`,
    'picker.department': 'Programme',
    'picker.loading': 'Loading…',
    'picker.empty': 'No match.',
    'picker.hint': 'Your choice is saved on this device.',
    'picker.identityHint': 'You can change this any time from the ⋯ menu.',
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
    'error.rooms': 'Could not load the list of rooms.',
    'error.teachers': 'Could not load the list of teachers.',
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
