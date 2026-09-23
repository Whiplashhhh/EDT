<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import ResourcePicker from './components/ResourcePicker.vue';
import WeekStrip from './components/WeekStrip.vue';
import DayAgenda from './components/DayAgenda.vue';
import WeekGrid from './components/WeekGrid.vue';
import { useSchedule } from './composables/useSchedule.js';
import { readSettings, writeSettings } from './composables/useStorage.js';
import { addDays, formatDayLong, mondayOf, today } from './dates.js';
import { api } from './api.js';
import { LOCALES, setLocale, t } from './i18n.js';

const THEMES = ['system', 'light', 'dark'];

const settings = ref(readSettings());
const department = computed(() => settings.value.department);
const kind = computed(() => settings.value.kind);
const resourceId = computed(() => settings.value.resourceId);

const focusedDay = ref(today());
const pickerOpen = ref(!settings.value.resourceId);
const menuOpen = ref(false);
const now = ref(Date.now());

const { eventsByDay, loading, error, stale, load } = useSchedule(department, kind, resourceId, focusedDay);

/*
 * Thème et langue sont appliqués au document lui-même : le thème par un attribut
 * que la feuille de style écoute, la langue par le module de traduction.
 * « system » retire l'attribut et laisse `prefers-color-scheme` décider.
 */
watch(() => settings.value.theme, (theme) => {
  const explicit = theme === 'light' || theme === 'dark';
  if (explicit) document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
  paintBrowserChrome(explicit ? theme : null);
}, { immediate: true });

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

watch(() => settings.value.lang, setLocale, { immediate: true });

function setTheme(theme) {
  settings.value = { ...settings.value, theme };
  writeSettings(settings.value);
}

function setLang(lang) {
  settings.value = { ...settings.value, lang };
  writeSettings(settings.value);
}

/*
 * Au premier affichage, si la journée en cours est vide (week-end, vacances),
 * on saute au prochain jour qui a cours plutôt que d'ouvrir sur une page vide.
 */
let jumped = false;
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

let ticker;
let refresher;
// Dernier jour calendaire connu, pour détecter le passage de minuit.
let currentDay = today();

onMounted(() => {
  load();
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
    if (document.visibilityState === 'visible') load(true);
  }, 10 * 60_000);
  document.addEventListener('visibilitychange', onVisible);
});
onUnmounted(() => {
  clearInterval(ticker);
  clearInterval(refresher);
  document.removeEventListener('visibilitychange', onVisible);
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
  load(true);
}

function choose({ department: dept, kind: pickedKind, resourceId: id, resourceName }) {
  settings.value = { ...settings.value, department: dept, kind: pickedKind, resourceId: id, resourceName };
  writeSettings(settings.value);
  pickerOpen.value = false;
  menuOpen.value = false;
  focusedDay.value = today();
}

function setView(view) {
  settings.value = { ...settings.value, view };
  writeSettings(settings.value);
}

function shiftDay(delta) {
  focusedDay.value = addDays(focusedDay.value, delta);
}

/* Navigation au doigt : un balayage horizontal franc change de jour. */
let touchStart = null;
function onTouchStart(event) {
  if (event.touches.length !== 1) return;
  touchStart = { x: event.touches[0].clientX, y: event.touches[0].clientY };
}
function onTouchEnd(event) {
  if (!touchStart) return;
  const touch = event.changedTouches[0];
  const dx = touch.clientX - touchStart.x;
  const dy = touch.clientY - touchStart.y;
  touchStart = null;
  if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.8) shiftDay(dx < 0 ? 1 : -1);
}

function onKeydown(event) {
  if (event.key === 'Escape') {
    pickerOpen.value = false;
    menuOpen.value = false;
    return;
  }
  if (pickerOpen.value || menuOpen.value) return;
  if (event.key === 'ArrowRight') shiftDay(1);
  if (event.key === 'ArrowLeft') shiftDay(-1);
  if (event.key.toLowerCase() === 't') focusedDay.value = today();
}
watch(pickerOpen, (open) => { if (open) menuOpen.value = false; });
watch(menuOpen, (open) => { if (open) pickerOpen.value = false; });
</script>

<template>
  <div class="app" tabindex="-1" @keydown="onKeydown">
    <header class="top">
      <div class="identity">
        <p class="eyebrow">{{ t(`app.eyebrow.${settings.kind}`) }}</p>
        <button class="group-btn" type="button" :aria-expanded="pickerOpen" @click="pickerOpen = !pickerOpen">
          {{ settings.resourceName || t('app.pickResource') }}
          <span class="chev" aria-hidden="true">▾</span>
        </button>
      </div>
      <div class="actions">
        <button
          v-if="!isToday"
          class="pill"
          type="button"
          @click="focusedDay = today()"
        >{{ t('app.today') }}</button>
        <button class="icon" type="button" :aria-expanded="menuOpen" :aria-label="t('app.options')" @click="menuOpen = !menuOpen">⋯</button>
      </div>
    </header>

    <div v-if="pickerOpen" class="menu-backdrop" @click="pickerOpen = false"></div>
    <div v-if="pickerOpen" class="dropdown picker-panel" role="dialog" :aria-label="t('app.pickResource')">
      <ResourcePicker
        :department="settings.department"
        :kind="settings.kind"
        :resource-id="settings.resourceId"
        @choose="choose"
        @close="pickerOpen = false"
      />
    </div>

    <div v-if="menuOpen" class="menu-backdrop" @click="menuOpen = false"></div>
    <div v-if="menuOpen" class="dropdown menu" role="menu">
      <button type="button" role="menuitem" @click="setView(settings.view === 'day' ? 'week' : 'day'); menuOpen = false">
        {{ settings.view === 'day' ? t('app.viewWeek') : t('app.viewDay') }}
      </button>
      <button type="button" role="menuitem" @click="pickerOpen = true">{{ t('app.changeResource') }}</button>
      <a v-if="calendarUrl" role="menuitem" :href="calendarUrl">{{ t('app.subscribe') }}</a>
      <button type="button" role="menuitem" @click="load(true); menuOpen = false">{{ t('app.refresh') }}</button>

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

      <div class="setting" role="group" :aria-label="t('app.language')">
        <span class="setting-label">{{ t('app.language') }}</span>
        <div class="segmented">
          <button
            v-for="option in LOCALES"
            :key="option.id"
            type="button"
            :class="{ on: settings.lang === option.id }"
            :aria-pressed="settings.lang === option.id"
            :aria-label="option.label"
            @click="setLang(option.id)"
          >{{ option.short }}</button>
        </div>
      </div>
    </div>

    <main v-if="settings.resourceId" class="main" @touchstart.passive="onTouchStart" @touchend.passive="onTouchEnd">
      <div class="strip-stage">
        <Transition :name="slideName">
          <WeekStrip
            :key="weekKey"
            :focused="focusedDay"
            :events-by-day="eventsByDay"
            @select="focusedDay = $event"
            @shift="shiftDay"
          />
        </Transition>
      </div>

      <p v-if="error" class="banner error" role="status">{{ error }}</p>
      <p v-else-if="stale" class="banner" role="status">{{ t('app.stale') }}</p>

      <Transition :name="slideName" mode="out-in">
        <div :key="viewKey" class="view">
          <template v-if="settings.view === 'day'">
            <h2 class="day-title">
              {{ formatDayLong(focusedDay) }}
              <span v-if="isToday" class="badge">{{ t('app.todayBadge') }}</span>
            </h2>
            <DayAgenda :day="focusedDay" :events="dayEvents" :now="now" :show-menu="settings.kind === 'groups'" :context="settings.kind" />
          </template>
          <WeekGrid v-else :focused="focusedDay" :department="settings.department" :events-by-day="eventsByDay" :now="now" :context="settings.kind" @select="focusedDay = $event; setView('day')" />
        </div>
      </Transition>

      <p v-if="loading && !dayEvents.length" class="banner" role="status">{{ t('app.loading') }}</p>
    </main>

    <!-- Première ouverture : le panneau est déjà déroulé, on dit juste quoi y faire. -->
    <p v-else class="welcome">
      <span class="emoji" aria-hidden="true">🎓</span>
      {{ t('app.welcome') }}
    </p>
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
  right: 0.85rem;
  display: flex;
  flex-direction: column;
  min-width: 15rem;
  padding: 0.35rem;
}

.picker-panel {
  left: 0.85rem;
  display: flex;
  flex-direction: column;
  width: min(24rem, calc(100vw - 1.7rem));
  /* Le panneau ne dépasse jamais l'écran : c'est l'arbre qui défile. */
  max-height: min(70vh, 30rem);
  overflow: hidden;
}
.menu > :where(button, a) {
  padding: 0.6rem 0.7rem;
  border-radius: var(--radius-sm);
  text-align: left;
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
  left: 0;
  right: 0;
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
