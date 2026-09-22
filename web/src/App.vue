<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import GroupPicker from './components/GroupPicker.vue';
import WeekStrip from './components/WeekStrip.vue';
import DayAgenda from './components/DayAgenda.vue';
import WeekGrid from './components/WeekGrid.vue';
import { useSchedule } from './composables/useSchedule.js';
import { readSettings, writeSettings } from './composables/useStorage.js';
import { addDays, formatDayLong, today } from './dates.js';
import { api } from './api.js';

const settings = ref(readSettings());
const department = computed(() => settings.value.department);
const groupId = computed(() => settings.value.groupId);

const focusedDay = ref(today());
const pickerOpen = ref(!settings.value.groupId);
const menuOpen = ref(false);
const now = ref(Date.now());

const { eventsByDay, loading, error, stale, load } = useSchedule(department, groupId, focusedDay);

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
const calendarUrl = computed(() =>
  department.value && groupId.value ? api.calendarUrl(department.value, groupId.value) : null,
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

function choose({ department: dept, groupId: id, groupName }) {
  settings.value = { ...settings.value, department: dept, groupId: id, groupName };
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
        <p class="eyebrow">Emploi du temps</p>
        <button class="group-btn" type="button" :aria-expanded="pickerOpen" @click="pickerOpen = !pickerOpen">
          {{ settings.groupName || 'Choisir sa classe' }}
          <span class="chev" aria-hidden="true">▾</span>
        </button>
      </div>
      <div class="actions">
        <button
          v-if="!isToday"
          class="pill"
          type="button"
          @click="focusedDay = today()"
        >Aujourd’hui</button>
        <button class="icon" type="button" :aria-expanded="menuOpen" aria-label="Options" @click="menuOpen = !menuOpen">⋯</button>
      </div>
    </header>

    <div v-if="pickerOpen" class="menu-backdrop" @click="pickerOpen = false"></div>
    <div v-if="pickerOpen" class="dropdown picker-panel" role="dialog" aria-label="Choisir sa classe">
      <GroupPicker
        :department="settings.department"
        :group-id="settings.groupId"
        @choose="choose"
        @close="pickerOpen = false"
      />
    </div>

    <div v-if="menuOpen" class="menu-backdrop" @click="menuOpen = false"></div>
    <div v-if="menuOpen" class="dropdown menu" role="menu">
      <button type="button" role="menuitem" @click="setView(settings.view === 'day' ? 'week' : 'day'); menuOpen = false">
        {{ settings.view === 'day' ? 'Vue semaine' : 'Vue jour' }}
      </button>
      <button type="button" role="menuitem" @click="pickerOpen = true">Changer de classe</button>
      <a v-if="calendarUrl" role="menuitem" :href="calendarUrl">S’abonner au calendrier (.ics)</a>
      <button type="button" role="menuitem" @click="load(true); menuOpen = false">Actualiser</button>
    </div>

    <main v-if="settings.groupId" class="main" @touchstart.passive="onTouchStart" @touchend.passive="onTouchEnd">
      <WeekStrip :focused="focusedDay" :events-by-day="eventsByDay" @select="focusedDay = $event" @shift="shiftDay" />

      <p v-if="error" class="banner error" role="status">{{ error }}</p>
      <p v-else-if="stale" class="banner" role="status">Données enregistrées sur l’appareil — actualisation en cours…</p>

      <template v-if="settings.view === 'day'">
        <h2 class="day-title">
          {{ formatDayLong(focusedDay) }}
          <span v-if="isToday" class="badge">aujourd’hui</span>
        </h2>
        <DayAgenda :day="focusedDay" :events="dayEvents" :now="now" />
      </template>
      <WeekGrid v-else :focused="focusedDay" :events-by-day="eventsByDay" :now="now" @select="focusedDay = $event; setView('day')" />

      <p v-if="loading && !dayEvents.length" class="banner" role="status">Chargement…</p>
    </main>

    <!-- Première ouverture : le panneau est déjà déroulé, on dit juste quoi y faire. -->
    <p v-else class="welcome">
      <span class="emoji" aria-hidden="true">🎓</span>
      Choisis ta classe pour afficher son emploi du temps.
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
.menu > * {
  padding: 0.6rem 0.7rem;
  border-radius: var(--radius-sm);
  text-align: left;
  font-size: 0.92rem;
  color: var(--text);
  text-decoration: none;
}
.menu > *:hover { background: var(--bg-sunken); }

.main { flex: 1; padding-top: 0.6rem; }

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
