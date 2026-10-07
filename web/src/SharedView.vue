<script setup>
/*
 * Page en lecture seule d'une semaine ou d'une journée partagée (voir
 * `share.js`). Elle s'adresse à qui n'a pas d'emploi du temps ici — un parent,
 * un ami — : pas d'identité à choisir, pas de classe à changer, rien d'autre à
 * voir que la période reçue. Elle ne touche pas aux réglages de l'appareil, à
 * la langue et au thème près : quelqu'un qui a déjà l'application retrouve la
 * sienne intacte.
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import WeekStrip from './components/WeekStrip.vue';
import DayAgenda from './components/DayAgenda.vue';
import WeekGrid from './components/WeekGrid.vue';
import EventDetail from './components/EventDetail.vue';
import { useSchedule } from './composables/useSchedule.js';
import { useEventDetail } from './composables/useEventDetail.js';
import { readSettings, writeSettings } from './composables/useStorage.js';
import { addDays, formatDayLong, formatDayMonth, formatStamp, today } from './dates.js';
import { LOCALES, LOCALE_REGIONS, setLocale, t } from './i18n.js';
import { resolveShareLink, sharePath } from './share.js';

const props = defineProps({
  /** `{ link, period, day }`, tel que le lit `readSharedPage`. */
  page: { type: Object, required: true },
});

const THEMES = ['system', 'light', 'dark'];
const { link, period } = props.page;
const isWeek = period === 'week';

/* La période partagée : les sept jours de la semaine, ou le seul jour reçu. */
const first = props.page.day;
const last = isWeek ? addDays(first, 6) : first;
const within = (day) => day >= first && day <= last;

const stored = readSettings();
const lang = ref(stored.lang);
const theme = ref(stored.theme);

watch(lang, setLocale, { immediate: true });
watch(theme, (value) => {
  if (value === 'light' || value === 'dark') document.documentElement.dataset.theme = value;
  else delete document.documentElement.dataset.theme;
}, { immediate: true });

/*
 * Langue et thème sont des préférences de l'appareil, pas de la page : on les
 * garde pour la prochaine fois, sans rien changer d'autre aux réglages.
 */
function savePreference(key, value) {
  if (key === 'lang') lang.value = value;
  else theme.value = value;
  writeSettings({ ...readSettings(), [key]: value });
}

const focusedDay = ref(isWeek && within(today()) ? today() : first);
/* Une journée se montre en jour ; une semaine, comme l'appareil la montrerait. */
const view = ref(isWeek ? stored.view : 'day');

const { eventsByDay, grid, loading, error, stale, outdated, load } = useSchedule(
  computed(() => link.department),
  computed(() => link.kind),
  computed(() => link.resourceId),
  focusedDay,
  { cacheSlot: 'shared' },
);
const outdatedText = computed(() =>
  outdated.value
    ? t(outdated.value.reason === 'ade' ? 'app.adeDown' : 'app.offline', { time: formatStamp(outdated.value.fetchedAt) })
    : null,
);
const dayEvents = computed(() => eventsByDay.value.get(focusedDay.value) || []);

/*
 * En vue jour, une semaine s'ouvre sur un jour qui a cours : aujourd'hui s'il
 * en a, sinon le suivant dans la semaine, sinon le premier.
 */
let jumped = !isWeek;
watch(eventsByDay, (map) => {
  if (jumped || map.size === 0) return;
  jumped = true;
  if (map.get(focusedDay.value)?.length) return;
  const days = Array.from({ length: 7 }, (_, i) => addDays(first, i));
  const next = days.find((day) => day > focusedDay.value && map.get(day)?.length) ?? days.find((day) => map.get(day)?.length);
  if (next) focusedDay.value = next;
});

/* Le nom vient du serveur ; un lien qui ne mène plus à rien le dit. */
const resourceName = ref('');
const gone = ref(false);

const periodLabel = computed(() =>
  isWeek ? t('shared.week', { date: formatDayMonth(`${first}T12:00:00Z`) }) : formatDayLong(first),
);
const past = computed(() => last < today());

watch([resourceName, periodLabel], ([name, period]) => {
  const label = period.charAt(0).toUpperCase() + period.slice(1);
  document.title = name ? `${name} · ${label}` : label;
}, { immediate: true });

const slideName = ref('slide-next');
watch(focusedDay, (day, previous) => {
  slideName.value = day < previous ? 'slide-prev' : 'slide-next';
});

/* On ne va d'un jour à l'autre qu'à l'intérieur de la semaine partagée. */
function step(direction) {
  if (!isWeek || view.value !== 'day') return;
  const next = addDays(focusedDay.value, direction);
  if (within(next)) focusedDay.value = next;
}

function selectDay(day) {
  if (within(day)) focusedDay.value = day;
}

let touchStart = null;
function onTouchStart(event) {
  if (event.touches.length !== 1) return;
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

const menuOpen = ref(false);
const { opened: detail, closeDetail } = useEventDetail();

function onKeydown(event) {
  if (event.key === 'Escape') {
    menuOpen.value = false;
    closeDetail();
    return;
  }
  if (menuOpen.value || detail.value) return;
  if (event.key === 'ArrowRight') step(1);
  if (event.key === 'ArrowLeft') step(-1);
}

function print() {
  menuOpen.value = false;
  window.print();
}

/* L'application complète, pour un camarade : elle lui proposera d'en faire sa classe. */
const appPath = sharePath(link);

const localeGroups = LOCALE_REGIONS.map((region) => ({ region, locales: LOCALES.filter((l) => l.region === region) }));

const now = ref(Date.now());
let ticker;
let refresher;

onMounted(async () => {
  load();
  ticker = setInterval(() => { now.value = Date.now(); }, 30_000);
  // Un cours annulé après l'envoi du lien doit se voir : la page se tient à jour.
  refresher = setInterval(() => {
    if (document.visibilityState === 'visible') load(true);
  }, 10 * 60_000);
  try {
    const resolved = await resolveShareLink(link);
    if (resolved?.kind) resourceName.value = resolved.resourceName;
    else gone.value = true;
  } catch {
    // Hors ligne : l'emploi du temps enregistré s'affiche, sans son nom.
  }
});
onUnmounted(() => {
  clearInterval(ticker);
  clearInterval(refresher);
});
</script>

<template>
  <div class="app" tabindex="-1" @keydown="onKeydown">
    <header class="top">
      <div class="identity">
        <p class="eyebrow">{{ t('shared.eyebrow') }}</p>
        <h1 class="name">{{ resourceName || t(`app.eyebrow.${link.kind}`) }}</h1>
        <p class="period">{{ periodLabel }}</p>
      </div>
      <button class="icon" type="button" :aria-expanded="menuOpen" :aria-label="t('app.options')" @click="menuOpen = !menuOpen">⋯</button>
    </header>

    <div v-if="menuOpen" class="menu-backdrop" @click="menuOpen = false"></div>
    <div v-if="menuOpen" class="dropdown menu" role="menu">
      <button type="button" role="menuitem" @click="print">{{ t('shared.print') }}</button>
      <a role="menuitem" :href="appPath">{{ t('shared.openApp') }}</a>

      <div class="setting" role="group" :aria-label="t('app.theme')">
        <span class="setting-label">{{ t('app.theme') }}</span>
        <div class="segmented">
          <button
            v-for="mode in THEMES"
            :key="mode"
            type="button"
            :class="{ on: theme === mode }"
            :aria-pressed="theme === mode"
            @click="savePreference('theme', mode)"
          >{{ t(`app.theme${mode[0].toUpperCase()}${mode.slice(1)}`) }}</button>
        </div>
      </div>

      <div class="setting">
        <label class="setting-label" for="shared-lang">{{ t('app.language') }}</label>
        <select id="shared-lang" class="select" :value="lang" @change="savePreference('lang', $event.target.value)">
          <optgroup v-for="group in localeGroups" :key="group.region" :label="t(`lang.${group.region}`)">
            <option v-for="option in group.locales" :key="option.id" :value="option.id">{{ option.label }}</option>
          </optgroup>
        </select>
      </div>
    </div>

    <p v-if="gone" class="welcome">
      <span class="emoji" aria-hidden="true">🔗</span>
      {{ t('shared.gone') }}
    </p>

    <main v-else class="main" @touchstart.passive="onTouchStart" @touchend.passive="onTouchEnd">
      <!-- Une semaine se lit en jour ou d'un bloc ; une journée n'a pas le choix. -->
      <div v-if="isWeek" class="view-switch segmented" role="group" :aria-label="t('app.display')">
        <button
          v-for="option in ['day', 'week']"
          :key="option"
          type="button"
          :class="{ on: view === option }"
          :aria-pressed="view === option"
          @click="view = option"
        >{{ t(option === 'day' ? 'app.viewDay' : 'app.viewWeek') }}</button>
      </div>

      <WeekStrip
        v-if="isWeek"
        :focused="focusedDay"
        :events-by-day="eventsByDay"
        :show-days="view === 'day'"
        :navigable="false"
        @select="selectDay"
      />

      <p v-if="past" class="banner" role="status">{{ t(isWeek ? 'shared.pastWeek' : 'shared.pastDay') }}</p>
      <p v-if="error" class="banner error" role="status">{{ error }}</p>
      <p v-else-if="outdatedText" class="banner" role="status">{{ outdatedText }}</p>
      <p v-else-if="stale" class="banner" role="status">{{ t('app.stale') }}</p>

      <Transition :name="slideName" mode="out-in">
        <div :key="view === 'day' ? focusedDay : 'week'" class="view">
          <template v-if="view === 'day'">
            <!-- Une journée seule est déjà datée par l'en-tête. -->
            <h2 v-if="isWeek" class="day-title">
              {{ formatDayLong(focusedDay) }}
              <span v-if="focusedDay === today()" class="badge">{{ t('app.todayBadge') }}</span>
            </h2>
            <DayAgenda :day="focusedDay" :events="dayEvents" :now="now" :show-menu="false" :context="link.kind" :department="link.department" />
          </template>
          <WeekGrid v-else :focused="first" :department="grid" :events-by-day="eventsByDay" :now="now" :context="link.kind" @select="selectDay($event); view = 'day'" />
        </div>
      </Transition>

      <p v-if="loading && !eventsByDay.size" class="banner" role="status">{{ t('app.loading') }}</p>
    </main>

    <footer class="colophon">
      <span>{{ t('about.notice') }}</span>
      <a :href="appPath">{{ t('shared.openApp') }}</a>
    </footer>

    <EventDetail v-if="detail" :key="detail.event.uid" :event="detail.event" :context="detail.context" :now="now" @close="closeDetail" />
  </div>
</template>

<style scoped>
/* Les mêmes repères que l'application : on doit s'y retrouver d'une page à l'autre. */
.app {
  min-height: 100%;
  display: flex;
  flex-direction: column;
  outline: none;
  position: relative;
}

.top {
  position: sticky;
  top: 0;
  z-index: 3;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
  padding: calc(0.7rem + var(--safe-top)) 0.85rem 0.6rem;
  background: color-mix(in srgb, var(--bg) 88%, transparent);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--line);
}
.identity { min-width: 0; }
.eyebrow { margin: 0; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted); }
.name {
  margin: 0;
  font-size: 1.28rem;
  font-weight: 700;
  letter-spacing: -0.01em;
  line-height: 1.2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.period { margin: 0.1rem 0 0; font-size: 0.85rem; font-weight: 600; color: var(--accent); }
.period::first-letter { text-transform: uppercase; }

.icon {
  flex: none;
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
  top: calc(4.6rem + var(--safe-top));
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
  max-width: calc(100vw - 1.7rem);
  padding: 0.35rem;
}
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

.main { flex: 1; padding-top: 0.6rem; overflow-x: clip; }
.view-switch { width: fit-content; margin: 0 auto 0.4rem; }
.view-switch button { padding: 0.3rem 0.9rem; }

.slide-next-enter-active,
.slide-prev-enter-active { transition: opacity 0.2s ease, transform 0.26s cubic-bezier(0.22, 0.61, 0.36, 1); }
.slide-next-leave-active,
.slide-prev-leave-active { transition: opacity 0.14s ease, transform 0.16s ease-in; }
.slide-next-enter-from { opacity: 0; transform: translateX(24px); }
.slide-next-leave-to { opacity: 0; transform: translateX(-18px); }
.slide-prev-enter-from { opacity: 0; transform: translateX(-24px); }
.slide-prev-leave-to { opacity: 0; transform: translateX(18px); }
@media (prefers-reduced-motion: reduce) {
  .slide-next-enter-from,
  .slide-next-leave-to,
  .slide-prev-enter-from,
  .slide-prev-leave-to { transform: none; }
}

.day-title {
  margin: 0.35rem 0.85rem 0.55rem;
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--text-muted);
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-height: 2rem;
}
.day-title::first-letter { text-transform: uppercase; }
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
.colophon a { color: var(--accent); text-underline-offset: 2px; }

@media (min-width: 760px) {
  .app { max-width: 62rem; margin: 0 auto; width: 100%; }
}

/*
 * Impression : la semaine sur une feuille, sans les boutons. L'en-tête cesse
 * de coller au haut de l'écran, et la grille, qui défile en largeur sur
 * téléphone, s'étale sur toute la page.
 */
@media print {
  .top { position: static; backdrop-filter: none; background: none; }
  .icon, .view-switch, .colophon, .banner { display: none; }
  .main { overflow: visible; }
  .main :deep(.scroller) { overflow: visible !important; }
}
</style>
