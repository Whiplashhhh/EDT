<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import ResourcePicker from './components/ResourcePicker.vue';
import WeekStrip from './components/WeekStrip.vue';
import DayAgenda from './components/DayAgenda.vue';
import WeekGrid from './components/WeekGrid.vue';
import FeedbackModal from './components/FeedbackModal.vue';
import EventDetail from './components/EventDetail.vue';
import { useSchedule } from './composables/useSchedule.js';
import { usePush } from './composables/usePush.js';
import { useInstall } from './composables/useInstall.js';
import { useEventDetail } from './composables/useEventDetail.js';
import { readSettings, writeSettings } from './composables/useStorage.js';
import { addDays, formatDayLong, formatStamp, mondayOf, today } from './dates.js';
import { api } from './api.js';
import { LOCALES, LOCALE_REGIONS, setLocale, t } from './i18n.js';

const THEMES = ['system', 'light', 'dark'];
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const settings = ref(readSettings());
const department = computed(() => settings.value.department);
const kind = computed(() => settings.value.kind);
const resourceId = computed(() => settings.value.resourceId);

/**
 * L'identité — sa classe, ou son nom si l'on enseigne — n'est pas la ressource
 * affichée. On peut aller voir l'emploi du temps d'une autre classe, d'un
 * enseignant ou d'une salle sans cesser d'être soi : c'est l'identité qui sert
 * de point de retour, et c'est elle, et elle seule, qui décide des
 * notifications reçues.
 */
const identity = computed(() => settings.value.identity);
const hasIdentity = computed(() => Boolean(identity.value));

/** Vrai quand la ressource affichée n'est pas la sienne. */
const viewingOther = computed(() => {
  const mine = identity.value;
  if (!mine) return false;
  return (
    mine.department !== settings.value.department ||
    mine.kind !== settings.value.kind ||
    mine.resourceId !== settings.value.resourceId
  );
});

/*
 * Une notification touchée ouvre l'application sur le jour concerné. Le
 * paramètre est retiré de l'URL aussitôt lu : rafraîchir la page ne doit pas
 * ramener indéfiniment à ce jour-là.
 */
function dayFromUrl() {
  const day = new URLSearchParams(location.search).get('day');
  if (!day || !DAY_RE.test(day)) return null;
  history.replaceState(null, '', location.pathname);
  return day;
}
const requestedDay = dayFromUrl();

const focusedDay = ref(requestedDay ?? today());
/** Choix de l'identité. Bloquant tant qu'elle n'est pas faite. */
const identityOpen = ref(!settings.value.identity);

/*
 * Zone réellement visible de la page. Sur iPhone, le clavier recouvre le bas
 * de l'écran sans réduire la fenêtre : un panneau fixe calé sur elle passe en
 * partie dessous, et sa barre de recherche avec. On se cale donc sur la zone
 * que le clavier laisse libre.
 */
const visibleArea = ref(null);
function measureVisibleArea() {
  const vv = window.visualViewport;
  visibleArea.value = vv ? { top: `${vv.offsetTop}px`, height: `${vv.height}px` } : null;
}
const pickerOpen = ref(false);
const menuOpen = ref(false);
const now = ref(Date.now());

const {
  supported: pushSupported,
  available: pushAvailable,
  busy: pushBusy,
  error: pushError,
  loadConfig: loadPushConfig,
  sync: syncPush,
} = usePush();

const { opened: detail, closeDetail } = useEventDetail();

const { mode: installMode, guideOpen: installGuideOpen, install, markDone: markInstalled } = useInstall();

/*
 * Contact, suggestion, problème : une seule fenêtre, ouverte sur le type du
 * bouton touché. Le message part au serveur, qui le relaie par courriel ;
 * l'adresse de l'auteur n'apparaît nulle part dans la page.
 */
const feedbackEnabled = ref(false);
/** Type de la fenêtre ouverte, ou `null` si elle est fermée. */
const feedbackKind = ref(null);

function openFeedback(kind) {
  feedbackKind.value = kind;
  menuOpen.value = false;
  pickerOpen.value = false;
}

/** Joint au message si on le laisse faire : de quoi comprendre un problème sans avoir à demander. */
const feedbackContext = computed(() => ({
  department: identity.value?.department ?? settings.value.department ?? null,
  identity: identity.value?.resourceName ?? null,
  identityKind: identity.value?.kind ?? null,
  viewing: settings.value.resourceName ?? null,
  lang: settings.value.lang ?? null,
  installed: Boolean(window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true),
  userAgent: navigator.userAgent,
  screen: `${window.innerWidth}×${window.innerHeight}`,
}));

const { eventsByDay, grid, loading, error, stale, outdated, load } = useSchedule(department, kind, resourceId, focusedDay);
/* Un emploi du temps qui n'est plus à jour reste un emploi du temps : on le dit
   sans alarmer, et l'on garde le rouge pour quand il n'y a rien à montrer. */
const outdatedText = computed(() =>
  outdated.value
    ? t(outdated.value.reason === 'ade' ? 'app.adeDown' : 'app.offline', { time: formatStamp(outdated.value.fetchedAt) })
    : null,
);

/*
 * Comparaison : un second emploi du temps, affiché à droite du premier en vue
 * jour. Chaque colonne se change ou se ferme indépendamment ; fermer celle de
 * gauche laisse celle de droite seule à l'écran, qui devient l'affichage
 * ordinaire. On peut donc comparer deux classes dont aucune n'est la sienne.
 */
const compare = computed(() => settings.value.compare);
const comparing = computed(() => Boolean(compare.value) && settings.value.view === 'day');
const {
  eventsByDay: compareEventsByDay,
  grid: compareGrid,
  error: compareError,
  load: loadCompare,
} = useSchedule(
  computed(() => compare.value?.department ?? null),
  computed(() => compare.value?.kind ?? 'groups'),
  computed(() => compare.value?.resourceId ?? null),
  focusedDay,
  { cacheSlot: 'compare' },
);

const compareSources = computed(() => [
  { key: 'main', side: 'main', name: settings.value.resourceName, context: settings.value.kind, eventsByDay: eventsByDay.value },
  { key: 'compare', side: 'compare', name: compare.value?.resourceName, context: compare.value?.kind, eventsByDay: compareEventsByDay.value },
]);
/* Deux formations n'ont pas forcément les mêmes créneaux : l'axe ne suit ceux
   de l'une que si l'autre les partage, sinon il se gradue en heures. */
const compareGridDept = computed(() => (grid.value === compareGrid.value ? grid.value : ''));

function reloadAll(force) {
  load(force);
  loadCompare(force);
}

/*
 * La barre du navigateur suit le thème choisi. Les deux balises `theme-color`
 * de l'index sont conditionnées à `prefers-color-scheme` : on en insère une
 * troisième, sans media et donc prioritaire, tant qu'un thème est imposé.
 */
const CHROME_COLORS = { dark: '#0f1115', light: '#f6f7f9' };
function paintBrowserChrome(theme) {
  const head = document.head;
  let meta = head.querySelector('meta[name="theme-color"]:not([media])');
  if (!theme) {
    meta?.remove();
    return;
  }
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    head.prepend(meta);
  }
  meta.content = CHROME_COLORS[theme];
}

/*
 * Thème et langue sont appliqués au document lui-même : le thème par un attribut
 * que la feuille de style écoute, la langue par le module de traduction.
 * « system » retire l'attribut et laisse `prefers-color-scheme` décider.
 * Le watcher part immédiatement : `CHROME_COLORS` doit être défini avant lui.
 */
watch(() => settings.value.theme, (theme) => {
  const explicit = theme === 'light' || theme === 'dark';
  if (explicit) document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
  paintBrowserChrome(explicit ? theme : null);
}, { immediate: true });

watch(() => settings.value.lang, setLocale, { immediate: true });

/*
 * Masquer le menu, c'est dire qu'on ne mange pas au Crous : la notification du
 * menu n'a plus de raison d'être, on l'éteint avec lui.
 */
function setCrousMenu(crousMenu) {
  settings.value = { ...settings.value, crousMenu };
  writeSettings(settings.value);
  if (!crousMenu && settings.value.push.menu) setPushOption('menu', false);
}

function setTheme(theme) {
  settings.value = { ...settings.value, theme };
  writeSettings(settings.value);
}

/* Le sélecteur groupe les langues par région : une liste de cinquante entrées
 * à plat ne se parcourt pas. */
const localeGroups = computed(() =>
  LOCALE_REGIONS.map((region) => ({ region, locales: LOCALES.filter((l) => l.region === region) })),
);

function setLang(lang) {
  settings.value = { ...settings.value, lang };
  writeSettings(settings.value);
}

/*
 * Au premier affichage, si la journée en cours est vide (week-end, vacances),
 * on saute au prochain jour qui a cours plutôt que d'ouvrir sur une page vide.
 */
// Un jour demandé par une notification est un choix explicite : on n'en bouge pas.
let jumped = Boolean(requestedDay);
watch(eventsByDay, (map) => {
  if (jumped || map.size === 0 || focusedDay.value !== today()) return;
  jumped = true;
  if (map.get(focusedDay.value)?.length) return;
  for (let i = 1; i <= 10; i += 1) {
    const day = addDays(today(), i);
    if (map.get(day)?.length) { focusedDay.value = day; return; }
  }
});

const dayEvents = computed(() => eventsByDay.value.get(focusedDay.value) || []);
const isToday = computed(() => focusedDay.value === today());
/* En vue semaine, aujourd'hui est déjà à l'écran tant que sa semaine est affichée. */
const showTodayButton = computed(() =>
  settings.value.view === 'day' ? !isToday.value : mondayOf(focusedDay.value) !== mondayOf(today()));

/*
 * Glissement d'un jour (ou d'une semaine) à l'autre : le sens du mouvement suit
 * le sens de la navigation, pour que l'écran se lise comme une bande continue.
 * La vue jour change à chaque date, la vue semaine seulement au changement de
 * semaine — sélectionner un jour déjà visible n'a rien à faire glisser.
 */
const slideName = ref('slide-next');
const weekKey = computed(() => mondayOf(focusedDay.value));
const viewKey = computed(() => (settings.value.view === 'day' ? focusedDay.value : weekKey.value));

watch(focusedDay, (day, previous) => {
  slideName.value = day < previous ? 'slide-prev' : 'slide-next';
});
const calendarUrl = computed(() =>
  department.value && resourceId.value ? api.calendarUrl(department.value, kind.value, resourceId.value) : null,
);
/**
 * En `webcal://`, le téléphone s'abonne au lieu d'importer le fichier une
 * fois : les changements de salle ou d'horaire suivent d'eux-mêmes.
 */
const webcalUrl = computed(() => calendarUrl.value?.replace(/^https?:/, 'webcal:') ?? null);

/**
 * Google Agenda ne connaît pas `webcal://` : on s'y abonne en collant l'adresse
 * dans « À partir de l'URL ». Le lien copié reste donc en `https://`.
 */
const linkCopied = ref(false);
let copiedTimer;
async function copyCalendarLink() {
  const url = calendarUrl.value;
  if (!url) return;
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    // Presse-papiers refusé (page non sécurisée, vieux navigateur) : on montre le lien à copier à la main.
    window.prompt(t('app.copyCalendarLink'), url);
    return;
  }
  linkCopied.value = true;
  clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => { linkCopied.value = false; }, 2500);
}

let ticker;
let refresher;
// Dernier jour calendaire connu, pour détecter le passage de minuit.
let currentDay = today();

onMounted(() => {
  reloadAll();
  // L'état « cours en cours » se rafraîchit sans recharger les données.
  ticker = setInterval(() => {
    now.value = Date.now();
    rollOverDay();
  }, 30_000);
  /*
   * Rechargement périodique tant que la page est visible : sans lui, un onglet
   * laissé ouvert garde indéfiniment les données de son premier chargement.
   * Dix minutes, c'est la durée de vie du cache serveur : demander plus souvent
   * ne rapporterait rien de plus frais.
   */
  refresher = setInterval(() => {
    if (document.visibilityState === 'visible') reloadAll(true);
  }, 10 * 60_000);
  document.addEventListener('visibilitychange', onVisible);
  measureVisibleArea();
  window.visualViewport?.addEventListener('resize', measureVisibleArea);
  window.visualViewport?.addEventListener('scroll', measureVisibleArea);

  /*
   * Un abonnement push peut mourir sans que la page le sache : autorisation
   * retirée, service de push qui renouvelle l'URL, serveur réinstallé. Le
   * renvoyer à chaque ouverture est la façon la plus simple de le garder vivant.
   */
  loadPushConfig().then(() => resyncPush());
  api.feedbackConfig().then(
    (config) => { feedbackEnabled.value = Boolean(config.enabled); },
    () => {},
  );
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', onServiceWorkerMessage);
  }
});
onUnmounted(() => {
  clearInterval(ticker);
  clearInterval(refresher);
  clearTimeout(copiedTimer);
  document.removeEventListener('visibilitychange', onVisible);
  window.visualViewport?.removeEventListener('resize', measureVisibleArea);
  window.visualViewport?.removeEventListener('scroll', measureVisibleArea);
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.removeEventListener('message', onServiceWorkerMessage);
  }
});

/** Suit l'utilisateur sur le nouveau jour à minuit, sauf s'il consulte une autre date. */
function rollOverDay() {
  const day = today();
  if (day === currentDay) return;
  if (focusedDay.value === currentDay) focusedDay.value = day;
  currentDay = day;
}

function onVisible() {
  if (document.visibilityState !== 'visible') return;
  now.value = Date.now();
  // Au retour dans l'application, on revient sur aujourd'hui si le jour a changé.
  rollOverDay();
  if (focusedDay.value < today()) focusedDay.value = today();
  reloadAll(true);
}

/** Colonne que le sélecteur remplace : l'affichage principal, ou celle de droite. */
const pickerTarget = ref('main');
const pickerCurrent = computed(() => (pickerTarget.value === 'compare' && compare.value ? compare.value : settings.value));

function openPicker(target) {
  pickerTarget.value = target;
  pickerOpen.value = true;
}

function choose({ department: dept, kind: pickedKind, resourceId: id, resourceName }) {
  const picked = { department: dept, kind: pickedKind, resourceId: id, resourceName };
  if (pickerTarget.value === 'compare') {
    // On compare un jour précis : celui qu'on regardait reste à l'écran.
    settings.value = { ...settings.value, compare: picked, view: 'day', viewChosen: true };
  } else {
    settings.value = { ...settings.value, ...picked };
    focusedDay.value = today();
  }
  writeSettings(settings.value);
  pickerOpen.value = false;
  menuOpen.value = false;
}

/**
 * Ferme une des deux colonnes. Celle de droite disparaît simplement ; fermer
 * celle de gauche fait de celle de droite l'affichage ordinaire.
 */
function closeColumn(side) {
  const promoted = side === 'main' ? compare.value : {};
  settings.value = { ...settings.value, ...promoted, compare: null };
  writeSettings(settings.value);
}

/**
 * Choix — ou changement — de son identité. Elle devient aussi la ressource
 * affichée : on vient de désigner l'emploi du temps qui est le sien, il n'y a
 * pas de raison de continuer à en regarder un autre.
 */
function chooseIdentity({ department: dept, kind: pickedKind, resourceId: id, resourceName }) {
  const mine = { department: dept, kind: pickedKind, resourceId: id, resourceName };
  settings.value = { ...settings.value, identity: mine, ...mine };
  writeSettings(settings.value);
  identityOpen.value = false;
  menuOpen.value = false;
  focusedDay.value = today();
}

/** Ramène l'affichage sur son propre emploi du temps, sans changer de jour. */
function backToMine() {
  if (!identity.value) return;
  settings.value = { ...settings.value, ...identity.value };
  writeSettings(settings.value);
  menuOpen.value = false;
}

/*
 * Notifications. L'interrupteur est optimiste : il bascule tout de suite, puis
 * on tente de s'abonner. Si le navigateur refuse — autorisation bloquée,
 * serveur sans clés — il revient à sa position d'origine, et le message
 * d'erreur dit pourquoi. Laisser un interrupteur allumé sur une notification
 * qui n'arrivera jamais serait pire que de le remettre à zéro.
 */
async function setPushOption(key, value) {
  const previous = settings.value.push;
  const next = { ...previous, [key]: value };
  settings.value = { ...settings.value, push: next };
  writeSettings(settings.value);

  const ok = await syncPush(identity.value, next, settings.value.lang);
  if (!ok && value) {
    settings.value = { ...settings.value, push: previous };
    writeSettings(settings.value);
  }
}

const pushOn = computed(
  () => settings.value.push.nextCourse || settings.value.push.changes || settings.value.push.menu,
);

/** Renvoie l'abonnement au serveur quand ce qu'il décrit a changé. */
function resyncPush() {
  if (!pushOn.value) return;
  syncPush(identity.value, settings.value.push, settings.value.lang);
}

// L'identité et la langue voyagent avec l'abonnement : le serveur doit les suivre.
watch([identity, () => settings.value.lang], resyncPush);

/** Message du service worker : notification touchée, ou abonnement renouvelé. */
function onServiceWorkerMessage(event) {
  const data = event.data;
  if (!data || typeof data !== 'object') return;
  if (data.type === 'show-day') {
    // Une notification ne parle jamais que de son propre emploi du temps.
    backToMine();
    if (typeof data.day === 'string' && DAY_RE.test(data.day)) focusedDay.value = data.day;
  }
  if (data.type === 'push-subscription-changed') resyncPush();
}

function setView(view) {
  // La comparaison n'existe qu'en vue jour : passer en semaine y met fin.
  settings.value = { ...settings.value, view, viewChosen: true, ...(view === 'week' ? { compare: null } : {}) };
  writeSettings(settings.value);
}

const isWeekend = (day) => day >= addDays(mondayOf(day), 5);

/**
 * Jour à ouvrir en passant de la semaine au jour. Sur la semaine en cours,
 * c'est aujourd'hui — ou, un week-end sans cours, le prochain jour de cours,
 * fût-il la semaine suivante. Sur une autre semaine, c'est le jour sélectionné,
 * sauf un week-end sans cours : on revient alors au lundi de cette semaine,
 * dont les cours ne sont pas encore passés.
 */
function dayToOpen() {
  const map = eventsByDay.value;
  const hasCourses = (day) => Boolean(map.get(day)?.length);
  const day = mondayOf(focusedDay.value) === mondayOf(today()) ? today() : focusedDay.value;
  if (!isWeekend(day) || hasCourses(day)) return day;
  if (day !== today()) return mondayOf(day);
  for (let i = 1; i <= 10; i += 1) {
    if (hasCourses(addDays(day, i))) return addDays(day, i);
  }
  return addDays(mondayOf(day), 7);
}

function switchView(view) {
  if (view === settings.value.view) return;
  if (view === 'day') focusedDay.value = dayToOpen();
  setView(view);
}

/* En vue semaine, les jours ne se sélectionnent plus un à un : on avance d'une semaine. */
function step(direction) {
  shiftDay(direction * (settings.value.view === 'week' ? 7 : 1));
}

function shiftDay(delta) {
  focusedDay.value = addDays(focusedDay.value, delta);
}

/* Navigation au doigt : un balayage horizontal franc change de jour. */
let touchStart = null;
function onTouchStart(event) {
  if (event.touches.length !== 1) return;
  // La grille de la semaine défile en largeur sur téléphone : la faire défiler n'est pas changer de semaine.
  const scroller = event.target.closest?.('.scroller');
  touchStart = { x: event.touches[0].clientX, y: event.touches[0].clientY, scroller, left: scroller?.scrollLeft };
}
function onTouchEnd(event) {
  if (!touchStart) return;
  const touch = event.changedTouches[0];
  const dx = touch.clientX - touchStart.x;
  const dy = touch.clientY - touchStart.y;
  const scrolled = touchStart.scroller && touchStart.scroller.scrollLeft !== touchStart.left;
  touchStart = null;
  if (scrolled) return;
  if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.8) step(dx < 0 ? 1 : -1);
}

function onKeydown(event) {
  if (event.key === 'Escape') {
    pickerOpen.value = false;
    menuOpen.value = false;
    installGuideOpen.value = false;
    feedbackKind.value = null;
    closeDetail();
    // Tant qu'aucune identité n'est choisie, il n'y a rien derrière à découvrir.
    if (hasIdentity.value) identityOpen.value = false;
    return;
  }
  if (pickerOpen.value || menuOpen.value || identityOpen.value || feedbackKind.value || detail.value) return;
  if (event.key === 'ArrowRight') step(1);
  if (event.key === 'ArrowLeft') step(-1);
  if (event.key.toLowerCase() === 't') focusedDay.value = today();
}
watch(pickerOpen, (open) => { if (open) { menuOpen.value = false; identityOpen.value = false; } });
watch(menuOpen, (open) => { if (open) pickerOpen.value = false; });
watch(identityOpen, (open) => { if (open) { menuOpen.value = false; pickerOpen.value = false; } });
</script>

<template>
  <div class="app" tabindex="-1" @keydown="onKeydown">
    <header v-if="hasIdentity" class="top">
      <div class="identity">
        <p class="eyebrow">{{ t(`app.eyebrow.${settings.kind}`) }}</p>
        <button class="group-btn" type="button" :aria-expanded="pickerOpen && pickerTarget === 'main'" @click="pickerOpen ? (pickerOpen = false) : openPicker('main')">
          <span class="group-name">{{ settings.resourceName || t('app.pickResource') }}</span>
          <span class="chev" aria-hidden="true">▾</span>
        </button>
      </div>
      <div class="actions">
        <!--
          Disparaît une fois l'application sur l'écran d'accueil. Il cède aussi
          la place quand le retour et « aujourd'hui » occupent déjà l'en-tête.
        -->
        <button
          v-if="installMode && !(viewingOther && showTodayButton)"
          class="pill install"
          :class="{ compact: viewingOther || showTodayButton }"
          type="button"
          :aria-label="t('install.title')"
          :title="t('install.title')"
          @click="install"
        >
          <span aria-hidden="true">＋</span>
          <!-- Aux côtés d'autres pastilles, le libellé ferait déborder l'en-tête. -->
          <span v-if="!viewingOther && !showTodayButton">{{ t('install.short') }}</span>
        </button>
        <!-- Le chemin du retour reste visible tant qu'on regarde ailleurs que chez soi. -->
        <button
          v-if="viewingOther"
          class="pill mine"
          type="button"
          :aria-label="t('app.backToMine', { name: identity.resourceName })"
          :title="t('app.backToMine', { name: identity.resourceName })"
          @click="backToMine"
        >
          <span aria-hidden="true">↩</span>
          <span class="mine-name">{{ identity.resourceName }}</span>
        </button>
        <button
          v-if="showTodayButton"
          class="pill"
          type="button"
          @click="focusedDay = today()"
        >{{ t('app.today') }}</button>
        <button class="icon" type="button" :aria-expanded="menuOpen" :aria-label="t('app.options')" @click="menuOpen = !menuOpen">⋯</button>
      </div>
    </header>

    <div v-if="pickerOpen" class="menu-backdrop" @click="pickerOpen = false"></div>
    <div
      v-if="pickerOpen"
      class="dropdown picker-panel"
      :class="{ right: pickerTarget === 'compare' }"
      role="dialog"
      :aria-label="pickerTarget === 'compare' ? t('compare.pick') : t('app.pickResource')"
    >
      <ResourcePicker
        :key="pickerTarget"
        :department="pickerCurrent.department"
        :kind="pickerCurrent.kind"
        :resource-id="pickerCurrent.resourceId"
        @choose="choose"
        @close="pickerOpen = false"
      />
    </div>

    <div v-if="menuOpen" class="menu-backdrop" @click="menuOpen = false"></div>
    <div v-if="menuOpen" class="dropdown menu" role="menu">
      <button type="button" role="menuitem" @click="openPicker('main')">{{ t('app.changeResource') }}</button>
      <button v-if="comparing" type="button" role="menuitem" @click="closeColumn('compare'); menuOpen = false">{{ t('compare.stop') }}</button>
      <button v-else type="button" role="menuitem" @click="openPicker('compare')">{{ t('compare.start') }}</button>
      <button type="button" role="menuitem" @click="identityOpen = true">{{ t('app.changeIdentity') }}</button>
      <a v-if="webcalUrl" role="menuitem" :href="webcalUrl">{{ t('app.subscribe') }}</a>
      <button v-if="calendarUrl" type="button" role="menuitem" @click="copyCalendarLink">
        {{ linkCopied ? t('app.linkCopied') : t('app.copyCalendarLink') }}
      </button>
      <button type="button" role="menuitem" @click="reloadAll(true); menuOpen = false">{{ t('app.refresh') }}</button>

      <!--
        Notifications. Elles suivent l'identité, jamais la ressource affichée :
        aller regarder l'emploi du temps d'une autre classe ne change pas les
        cours dont on veut être prévenu.
      -->
      <div class="setting stack" role="group" :aria-label="t('push.section')">
        <span class="setting-label">{{ t('push.section') }}</span>

        <label class="toggle">
          <input
            type="checkbox"
            :checked="settings.push.nextCourse"
            :disabled="pushBusy || !pushSupported"
            @change="setPushOption('nextCourse', $event.target.checked)"
          />
          <span class="toggle-text">
            <span class="toggle-title">{{ t('push.nextCourse') }}</span>
            <span class="toggle-hint">{{ t('push.nextCourseHint') }}</span>
          </span>
        </label>

        <label class="toggle">
          <input
            type="checkbox"
            :checked="settings.push.changes"
            :disabled="pushBusy || !pushSupported"
            @change="setPushOption('changes', $event.target.checked)"
          />
          <span class="toggle-text">
            <span class="toggle-title">{{ t('push.changes') }}</span>
            <span class="toggle-hint">{{ t('push.changesHint') }}</span>
          </span>
        </label>

        <label v-if="settings.crousMenu" class="toggle">
          <input
            type="checkbox"
            :checked="settings.push.menu"
            :disabled="pushBusy || !pushSupported"
            @change="setPushOption('menu', $event.target.checked)"
          />
          <span class="toggle-text">
            <span class="toggle-title">{{ t('push.menu') }}</span>
            <span class="toggle-hint">{{ t('push.menuHint') }}</span>
          </span>
        </label>

        <p v-if="!pushSupported" class="toggle-note">{{ t('push.unsupported') }}</p>
        <p v-else-if="pushError" class="toggle-note error" role="status">{{ t(pushError) }}</p>
        <p v-else-if="!pushAvailable" class="toggle-note">{{ t('push.unavailable') }}</p>
      </div>

      <div class="setting stack" role="group" :aria-label="t('app.display')">
        <span class="setting-label">{{ t('app.display') }}</span>
        <label class="toggle">
          <input
            type="checkbox"
            :checked="settings.crousMenu"
            @change="setCrousMenu($event.target.checked)"
          />
          <span class="toggle-text">
            <span class="toggle-title">{{ t('crous.show') }}</span>
            <span class="toggle-hint">{{ t('crous.showHint') }}</span>
          </span>
        </label>
      </div>

      <div class="setting" role="group" :aria-label="t('app.theme')">
        <span class="setting-label">{{ t('app.theme') }}</span>
        <div class="segmented">
          <button
            v-for="mode in THEMES"
            :key="mode"
            type="button"
            :class="{ on: settings.theme === mode }"
            :aria-pressed="settings.theme === mode"
            @click="setTheme(mode)"
          >{{ t(`app.theme${mode[0].toUpperCase()}${mode.slice(1)}`) }}</button>
        </div>
      </div>

      <div class="setting">
        <label class="setting-label" for="lang-select">{{ t('app.language') }}</label>
        <select
          id="lang-select"
          class="select"
          :value="settings.lang"
          @change="setLang($event.target.value)"
        >
          <optgroup v-for="group in localeGroups" :key="group.region" :label="t(`lang.${group.region}`)">
            <option v-for="option in group.locales" :key="option.id" :value="option.id">{{ option.label }}</option>
          </optgroup>
        </select>
      </div>

      <!-- Qui fait ce site, et comment le joindre : sans adresse affichée, le serveur relaie. -->
      <div class="setting stack about" role="group" :aria-label="t('about.section')">
        <span class="setting-label">{{ t('about.section') }}</span>
        <p class="toggle-note">{{ t('about.notice') }}</p>
        <template v-if="feedbackEnabled">
          <button type="button" role="menuitem" @click="openFeedback('contact')">{{ t('feedback.title.contact') }}</button>
          <button type="button" role="menuitem" @click="openFeedback('suggestion')">{{ t('feedback.title.suggestion') }}</button>
          <button type="button" role="menuitem" @click="openFeedback('bug')">{{ t('feedback.title.bug') }}</button>
        </template>
      </div>
    </div>

    <main v-if="hasIdentity && settings.resourceId" class="main" @touchstart.passive="onTouchStart" @touchend.passive="onTouchEnd">
      <div class="view-switch segmented" role="group" :aria-label="t('app.display')">
        <button
          v-for="view in ['day', 'week']"
          :key="view"
          type="button"
          :class="{ on: settings.view === view }"
          :aria-pressed="settings.view === view"
          @click="switchView(view)"
        >{{ t(view === 'day' ? 'app.viewDay' : 'app.viewWeek') }}</button>
      </div>

      <div class="strip-stage">
        <Transition :name="slideName">
          <WeekStrip
            :key="weekKey"
            :focused="focusedDay"
            :events-by-day="eventsByDay"
            :show-days="settings.view === 'day'"
            @select="focusedDay = $event"
            @shift="shiftDay"
          />
        </Transition>
      </div>

      <p v-if="error" class="banner error" role="status">{{ error }}</p>
      <p v-else-if="outdatedText" class="banner" role="status">{{ outdatedText }}</p>
      <p v-else-if="stale" class="banner" role="status">{{ t('app.stale') }}</p>
      <p v-if="comparing && compareError" class="banner error" role="status">{{ compare.resourceName }} · {{ compareError }}</p>

      <Transition :name="slideName" mode="out-in">
        <div :key="viewKey" class="view">
          <template v-if="settings.view === 'day'">
            <h2 class="day-title">
              {{ formatDayLong(focusedDay) }}
              <span v-if="isToday" class="badge">{{ t('app.todayBadge') }}</span>
            </h2>
            <!--
              Côte à côte, sur un même axe horaire : c'est la grille de la vue
              semaine, une colonne par emploi du temps au lieu d'une par jour.
            -->
            <WeekGrid
              v-if="comparing"
              :focused="focusedDay"
              :department="compareGridDept"
              :events-by-day="eventsByDay"
              :sources="compareSources"
              :now="now"
            >
              <template #head="{ source }">
                <div class="compare-head">
                  <button
                    class="compare-name"
                    type="button"
                    :aria-label="t('compare.change', { name: source.name })"
                    :title="t('compare.change', { name: source.name })"
                    @click="openPicker(source.side)"
                  >
                    <span class="compare-label">{{ source.name }}</span>
                    <span class="chev" aria-hidden="true">▾</span>
                  </button>
                  <button
                    class="compare-close"
                    type="button"
                    :aria-label="t('compare.close', { name: source.name })"
                    :title="t('compare.close', { name: source.name })"
                    @click="closeColumn(source.side)"
                  >✕</button>
                </div>
              </template>
            </WeekGrid>
            <DayAgenda v-else :day="focusedDay" :events="dayEvents" :now="now" :show-menu="settings.crousMenu && settings.kind === 'groups'" :context="settings.kind" :department="settings.department" />
          </template>
          <WeekGrid v-else :focused="focusedDay" :department="grid" :events-by-day="eventsByDay" :now="now" :context="settings.kind" @select="focusedDay = $event; setView('day')" />
        </div>
      </Transition>

      <p v-if="loading && !dayEvents.length" class="banner" role="status">{{ t('app.loading') }}</p>
    </main>

    <p v-else-if="hasIdentity" class="welcome">
      <span class="emoji" aria-hidden="true">🎓</span>
      {{ t('app.welcome') }}
    </p>

    <footer v-if="hasIdentity" class="colophon">
      <span>{{ t('about.notice') }}</span>
      <template v-if="feedbackEnabled">
        <button type="button" @click="openFeedback('contact')">{{ t('about.contact') }}</button>
        <button type="button" @click="openFeedback('suggestion')">{{ t('feedback.title.suggestion') }}</button>
        <button type="button" @click="openFeedback('bug')">{{ t('feedback.title.bug') }}</button>
      </template>
    </footer>

    <FeedbackModal v-if="feedbackKind" :kind="feedbackKind" :context="feedbackContext" @close="feedbackKind = null" />

    <EventDetail v-if="detail" :key="detail.event.uid" :event="detail.event" :context="detail.context" :now="now" @close="closeDetail" />

    <!--
      Mode d'emploi, là où le navigateur ne laisse pas la page installer
      elle-même : on montre les gestes, l'utilisateur dit quand c'est fait.
    -->
    <div v-if="installGuideOpen" class="gate">
      <div class="gate-backdrop" @click="installGuideOpen = false"></div>
      <div class="gate-card install-card" role="dialog" aria-modal="true" :aria-label="t('install.title')">
        <div class="gate-head">
          <h1 class="gate-title">{{ t('install.title') }}</h1>
          <button class="icon" type="button" :aria-label="t('install.close')" @click="installGuideOpen = false">✕</button>
        </div>
        <ol class="install-steps">
          <template v-if="installMode === 'ios'">
            <li>{{ t('install.iosShare') }} <span class="install-glyph" aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 8l5-5 5 5M5 12v8h14v-8" /></svg></span></li>
            <li>{{ t('install.iosAdd') }}</li>
          </template>
          <template v-else>
            <li>{{ t('install.firefoxMenu') }} <span class="install-glyph" aria-hidden="true">⋮</span></li>
            <li>{{ t('install.firefoxAdd') }}</li>
          </template>
          <li>{{ t('install.name') }}</li>
        </ol>
        <button class="install-done" type="button" @click="markInstalled">{{ t('install.done') }}</button>
      </div>
    </div>

    <!--
      Première ouverture : tant qu'on n'a pas dit qui l'on est, il n'y a rien à
      afficher. L'écran est volontairement sans échappatoire — ni croix, ni
      clic à côté — car sans classe ni nom, l'application n'a pas d'emploi du
      temps à montrer ni de cours dont prévenir. Une fois l'identité choisie,
      le même écran redevient un panneau ordinaire, que l'on referme.
    -->
    <div v-if="identityOpen" class="gate" :class="{ blocking: !hasIdentity }" :style="visibleArea">
      <div v-if="hasIdentity" class="gate-backdrop" @click="identityOpen = false"></div>
      <div class="gate-card" role="dialog" aria-modal="true" :aria-label="t('gate.title')">
        <div class="gate-head">
          <div>
            <h1 class="gate-title">{{ t('gate.title') }}</h1>
            <p class="gate-intro">{{ t('gate.intro') }}</p>
            <p class="gate-intro">{{ t('gate.subjects') }}</p>
          </div>
          <button
            v-if="hasIdentity"
            class="icon"
            type="button"
            :aria-label="t('app.options')"
            @click="identityOpen = false"
          >✕</button>
        </div>

        <ResourcePicker
          identity-mode
          :department="identity?.department ?? settings.department"
          :kind="identity?.kind ?? settings.kind"
          :resource-id="identity?.resourceId ?? null"
          @choose="chooseIdentity"
          @close="hasIdentity && (identityOpen = false)"
        />

        <p class="gate-why">{{ t('gate.why') }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.app {
  min-height: 100%;
  display: flex;
  flex-direction: column;
  outline: none;
  /* Repère des panneaux déroulants : sans lui ils s'ancreraient à la fenêtre,
     donc de travers dès que l'application est centrée sur grand écran. */
  position: relative;
}

.top {
  position: sticky;
  top: 0;
  z-index: 3;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 0.75rem;
  padding: calc(0.7rem + var(--safe-top)) 0.85rem 0.6rem;
  background: color-mix(in srgb, var(--bg) 88%, transparent);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--line);
}
.eyebrow { margin: 0; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted); }
.group-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 1.28rem;
  font-weight: 700;
  letter-spacing: -0.01em;
  line-height: 1.2;
}
.chev { font-size: 0.7rem; color: var(--text-muted); }
/* Plusieurs ressources réunies font un long nom : il se tronque, l'en-tête garde ses boutons. */
.identity { min-width: 0; }
.group-btn { max-width: 100%; }
.group-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.actions { display: flex; align-items: center; gap: 0.4rem; }
.pill {
  padding: 0.35rem 0.7rem;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--accent);
  background: var(--accent-soft);
  border-radius: 999px;
}
.icon {
  width: 2.2rem; height: 2.2rem;
  display: grid; place-items: center;
  font-size: 1.2rem;
  color: var(--text-muted);
  border-radius: 999px;
}
.icon:hover { background: var(--bg-elevated); color: var(--text); }

/*
 * Le retour vers son propre emploi du temps. Le nom peut être long : il se
 * tronque plutôt que de repousser le bouton « aujourd'hui » hors de l'écran.
 */
.pill.mine {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  max-width: 9rem;
  color: var(--text);
  background: var(--bg-sunken);
  border: 1px solid var(--line);
}
.pill.mine:hover { border-color: var(--accent); color: var(--accent); }

/* Plein, pour se distinguer des autres pastilles : c'est une invitation. */
.pill.install {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  white-space: nowrap;
  color: var(--bg);
  background: var(--accent);
}
.pill.install.compact { padding-inline: 0.55rem; }

.install-steps {
  margin: 0;
  padding-inline-start: 1.3rem;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  font-size: 0.92rem;
  line-height: 1.45;
}
.install-glyph {
  display: inline-grid;
  place-items: center;
  min-width: 1.5rem;
  padding: 0 0.3rem;
  font-weight: 700;
  color: var(--accent);
  background: var(--accent-soft);
  border-radius: 0.4rem;
}
.install-done {
  margin-top: 0.4rem;
  padding: 0.6rem;
  font-weight: 600;
  color: var(--accent);
  background: var(--accent-soft);
  border-radius: var(--radius-sm);
}
.mine-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.menu-backdrop { position: fixed; inset: 0; z-index: 3; }

.dropdown {
  position: absolute;
  z-index: 4;
  top: calc(3.9rem + var(--safe-top));
  background: var(--bg-elevated);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: 0 16px 40px rgb(0 0 0 / 0.28);
}

.menu {
  inset-inline-end: 0.85rem;
  display: flex;
  flex-direction: column;
  min-width: 15rem;
  padding: 0.35rem;
}

.picker-panel {
  inset-inline-start: 0.85rem;
  display: flex;
  flex-direction: column;
  width: min(24rem, calc(100vw - 1.7rem));
  /* Le panneau ne dépasse jamais l'écran : c'est l'arbre qui défile. */
  max-height: min(70vh, 30rem);
  overflow: hidden;
}
/* Le sélecteur de la colonne de droite s'ouvre de son côté. */
.picker-panel.right { inset-inline-start: auto; inset-inline-end: 0.85rem; }

.menu > :where(button, a) {
  padding: 0.6rem 0.7rem;
  border-radius: var(--radius-sm);
  text-align: start;
  font-size: 0.92rem;
  color: var(--text);
  text-decoration: none;
}
.menu > :where(button, a):hover { background: var(--bg-sunken); }

.setting {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.4rem 0.7rem;
}
/* Un filet sépare les réglages permanents des actions ponctuelles. */
.setting:first-of-type { margin-top: 0.3rem; border-top: 1px solid var(--line); padding-top: 0.6rem; }
.setting-label { font-size: 0.82rem; color: var(--text-muted); }

.segmented {
  display: flex;
  padding: 2px;
  background: var(--bg-sunken);
  border-radius: 999px;
}
.segmented button {
  padding: 0.25rem 0.55rem;
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--text-muted);
  border-radius: 999px;
  white-space: nowrap;
}
.segmented button:hover { color: var(--text); }
.segmented button.on { color: var(--accent); background: var(--bg-elevated); box-shadow: 0 1px 3px rgb(0 0 0 / 0.18); }

/* Le choix jour / semaine reste sous la main, au-dessus de la semaine affichée. */
.view-switch { width: fit-content; margin: 0 auto 0.4rem; }
.view-switch button { padding: 0.3rem 0.9rem; }

/* Liste déroulante native : elle sait déjà chercher au clavier et s'ouvre en
   plein écran sur mobile, ce qu'aucun menu maison ne fait aussi bien. */
.select {
  max-width: 11rem;
  padding: 0.3rem 0.55rem;
  font: inherit;
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--text);
  background: var(--bg-sunken);
  border: 1px solid var(--line);
  border-radius: 999px;
  cursor: pointer;
}
.select:hover { color: var(--accent); }
.select:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

/* Les réglages de notification s'expliquent : ils s'empilent au lieu de s'aligner. */
.setting.stack { flex-direction: column; align-items: stretch; gap: 0.5rem; }

.toggle {
  display: flex;
  align-items: flex-start;
  gap: 0.6rem;
  padding: 0.15rem 0;
  cursor: pointer;
}
.toggle input {
  flex: none;
  width: 1.05rem;
  height: 1.05rem;
  margin: 0.15rem 0 0;
  accent-color: var(--accent);
}
.toggle input:disabled { cursor: not-allowed; }
.toggle:has(input:disabled) { cursor: not-allowed; opacity: 0.55; }
.toggle-text { display: flex; flex-direction: column; gap: 0.1rem; min-width: 0; }
.toggle-title { font-size: 0.88rem; color: var(--text); }
/* La règle horaire est la seule chose qu'on ne devine pas : elle est écrite. */
.toggle-hint { font-size: 0.72rem; line-height: 1.35; color: var(--text-muted); }
.toggle-note { margin: 0; font-size: 0.72rem; line-height: 1.35; color: var(--text-muted); }
.toggle-note.error { color: var(--danger); }

/*
 * L'écran d'identité. Il couvre tout : au premier lancement parce qu'il n'y a
 * rien derrière, ensuite parce qu'un choix aussi structurant mérite l'écran
 * entier plutôt qu'un menu déroulant.
 */
.gate {
  position: fixed;
  inset: 0;
  z-index: 10;
  display: grid;
  place-items: center;
  padding: 1rem;
  padding-top: calc(1rem + var(--safe-top));
  background: color-mix(in srgb, var(--bg) 92%, transparent);
  backdrop-filter: blur(10px);
  container: gate / size;
}
.gate-backdrop { position: absolute; inset: 0; }

.gate-card {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  width: min(26rem, 100%);
  /* Sans cela, la largeur minimale du sélecteur pousse la carte hors de l'écran. */
  min-width: 0;
  max-height: min(100%, 42rem);
  /* Dernier recours si rien ne tient : la carte défile, rien ne se chevauche. */
  overflow-y: auto;
  padding: 1rem 0.9rem 0.8rem;
  background: var(--bg-elevated);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: 0 20px 50px rgb(0 0 0 / 0.3);
}

.gate-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 0.5rem; }
.gate-title { margin: 0 0 0.2rem; font-size: 1.15rem; font-weight: 700; letter-spacing: -0.01em; }
.gate-intro + .gate-intro { margin-top: 0.35rem; }
.gate-intro { margin: 0; font-size: 0.85rem; line-height: 1.45; color: var(--text-muted); }
.gate-why { margin: 0; font-size: 0.72rem; line-height: 1.4; color: var(--text-muted); }

/*
 * Le sélecteur occupe la place qui reste : c'est sa liste qui défile, pas la
 * carte. Il ne descend pas sous la hauteur de ses onglets et de ses champs.
 */
.gate-card :deep(.picker) { flex: 1; min-width: 0; padding: 0; }
/*
 * Sur un écran peu haut — téléphone à l'horizontale, petite fenêtre — il ne
 * reste pas de quoi faire défiler la liste à part : elle s'écrasait à rien et
 * le sélecteur débordait sur les onglets. On la laisse alors à sa hauteur, et
 * c'est la carte entière qui défile. La hauteur mesurée est celle de l'écran
 * de choix, qui suit la zone visible : le clavier ouvert compte aussi.
 */
@container gate (max-height: 32rem) {
  .gate-card :deep(.picker) { min-height: auto; }
}
/*
 * Sur téléphone, le clavier ne laisse qu'une bande d'écran : pendant la
 * frappe, les explications s'effacent devant la recherche et ses résultats.
 * Elles restent effacées tant qu'une recherche est saisie : toucher un
 * résultat ferme le clavier, et si elles revenaient à cet instant, la liste
 * descendrait sous le doigt et le toucher tomberait à côté.
 */
@media (pointer: coarse) {
  .gate-card:has(input:is(:focus, :not(:placeholder-shown))) .gate-intro,
  .gate-card:has(input:is(:focus, :not(:placeholder-shown))) .gate-why,
  .gate-card:has(input:is(:focus, :not(:placeholder-shown))) :deep(.hint) { display: none; }
}

.main { flex: 1; padding-top: 0.6rem; overflow-x: clip; }

/*
 * Le bandeau des jours garde une hauteur constante : les deux semaines peuvent
 * donc se croiser, celle qui part étant retirée du flux le temps du glissement.
 */
.strip-stage { position: relative; }
.strip-stage .slide-next-leave-active,
.strip-stage .slide-prev-leave-active {
  position: absolute;
  top: 0;
  inset-inline: 0;
}

/* Le contenu, lui, change de hauteur : il glisse en relais plutôt qu'en croisé. */
.slide-next-enter-active,
.slide-prev-enter-active { transition: opacity 0.2s ease, transform 0.26s cubic-bezier(0.22, 0.61, 0.36, 1); }
.slide-next-leave-active,
.slide-prev-leave-active { transition: opacity 0.14s ease, transform 0.16s ease-in; }

.slide-next-enter-from { opacity: 0; transform: translateX(24px); }
.slide-next-leave-to { opacity: 0; transform: translateX(-18px); }
.slide-prev-enter-from { opacity: 0; transform: translateX(-24px); }
.slide-prev-leave-to { opacity: 0; transform: translateX(18px); }

/* Un mouvement qui dérange se réduit à un fondu. */
@media (prefers-reduced-motion: reduce) {
  .slide-next-enter-from,
  .slide-next-leave-to,
  .slide-prev-enter-from,
  .slide-prev-leave-to { transform: none; }
}

.welcome {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  margin: 0;
  padding: 3rem 1.5rem;
  text-align: center;
  color: var(--text-muted);
}
.welcome .emoji { font-size: 1.8rem; }

/* Mentions discrètes en bas de page : présentes pour qui les cherche, sans rien disputer à l'emploi du temps. */
.colophon {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: baseline;
  gap: 0.25rem 0.9rem;
  padding: 1.4rem 1rem calc(1rem + var(--safe-bottom));
  font-size: 0.72rem;
  line-height: 1.4;
  text-align: center;
  color: var(--text-muted);
}
.colophon button { color: var(--accent); text-decoration: underline; text-underline-offset: 2px; }

/* Les boutons de contact se lisent comme les autres entrées du menu. */
.setting.about > button {
  margin-inline: -0.7rem;
  padding: 0.5rem 0.7rem;
  border-radius: var(--radius-sm);
  text-align: start;
  font-size: 0.92rem;
  color: var(--text);
}
.setting.about > button:hover { background: var(--bg-sunken); }

/*
 * En-tête d'une colonne comparée : le nom se touche pour changer d'emploi du
 * temps, la croix pour cesser de l'afficher. Le nom se tronque, jamais la croix.
 */
.compare-head { display: flex; align-items: center; gap: 0.15rem; width: 100%; min-width: 0; }
.compare-name {
  flex: 1;
  min-width: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.3rem;
  padding: 0.3rem 0.4rem;
  font-size: 0.85rem;
  font-weight: 700;
  border-radius: var(--radius-sm);
}
.compare-name:hover { background: var(--bg-elevated); color: var(--accent); }
.compare-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.compare-close {
  flex: none;
  width: 1.8rem;
  height: 1.8rem;
  display: grid;
  place-items: center;
  font-size: 0.8rem;
  color: var(--text-muted);
  border-radius: 999px;
}
.compare-close:hover { background: var(--bg-elevated); color: var(--danger); }

.day-title::first-letter { text-transform: uppercase; }

.day-title {
  margin: 0.35rem 0.85rem 0.55rem;
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--text-muted);
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.badge {
  padding: 0.05rem 0.45rem;
  font-size: 0.68rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--accent);
  background: var(--accent-soft);
  border-radius: 999px;
}

.banner {
  margin: 0 0.85rem 0.6rem;
  padding: 0.55rem 0.7rem;
  font-size: 0.83rem;
  color: var(--text-muted);
  background: var(--bg-elevated);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
}
.banner.error { color: var(--danger); border-color: color-mix(in srgb, var(--danger) 40%, var(--line)); }


@media (min-width: 760px) {
  .app { max-width: 62rem; margin: 0 auto; width: 100%; }
}
</style>
