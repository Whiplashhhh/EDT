<script setup>
import { computed, nextTick, onMounted, ref } from 'vue';
import { courseStyle } from '../colors.js';
import { durationMinutes, formatDayDate, formatMinutesSpan, formatTime } from '../dates.js';
import { t } from '../i18n.js';
import { alignToSlots } from '../slots.js';

/*
 * Fiche d'une ressource dans le bilan des heures : où elle en est, quand elle
 * reprend, quand elle s'arrête, et le détail de ses séances. Les durées restent
 * celles d'ADE ; les horaires des séances, eux, sont ceux qu'affiche
 * l'emploi du temps, pour qu'on les reconnaisse.
 */
const props = defineProps({
  /** Une ligne du bilan : `name`, `label`, `done`, `planned`, `sessions`. */
  subject: { type: Object, required: true },
  department: { type: String, required: true },
  now: { type: Number, required: true },
});
const emit = defineEmits(['close']);

const sheet = ref(null);
onMounted(() => nextTick(() => sheet.value?.focus()));

const tint = computed(() => courseStyle({ subject: props.subject.name }));

const sessions = computed(() => {
  const shown = alignToSlots(props.department, props.subject.sessions);
  return props.subject.sessions.map((session, i) => ({
    ...session,
    shownStart: shown[i].start,
    shownEnd: shown[i].end,
    minutes: Math.max(0, durationMinutes(session.start, session.end)),
    done: new Date(session.end).getTime() <= props.now,
  }));
});
const upcoming = computed(() => sessions.value.filter((s) => !s.done));
// Les plus récentes d'abord : c'est d'elles qu'on se souvient.
const past = computed(() => sessions.value.filter((s) => s.done).reverse());

// Un cours déjà commencé n'est plus « le prochain ».
const next = computed(() => upcoming.value.find((s) => new Date(s.start).getTime() > props.now) ?? null);
const last = computed(() => upcoming.value[upcoming.value.length - 1] ?? null);

const total = computed(() => props.subject.done.minutes + props.subject.planned.minutes);
const share = computed(() => (total.value ? Math.round((props.subject.done.minutes / total.value) * 100) : 0));

/** Heures passées et à venir, regroupées par `keysOf(séance)`. */
function tally(keysOf) {
  const byKey = new Map();
  for (const session of sessions.value) {
    for (const key of keysOf(session)) {
      const entry = byKey.get(key) ?? { key, done: { courses: 0, minutes: 0 }, planned: { courses: 0, minutes: 0 } };
      const side = session.done ? entry.done : entry.planned;
      side.courses += 1;
      side.minutes += session.minutes;
      byKey.set(key, entry);
    }
  }
  return [...byKey.values()].sort(
    (a, b) => b.done.minutes + b.planned.minutes - (a.done.minutes + a.planned.minutes) || a.key.localeCompare(b.key),
  );
}

// Le type de séance n'a de sens que si ADE en publie un : en BUT3, il n'y en a pas.
const byKind = computed(() =>
  sessions.value.some((s) => s.kind) ? tally((s) => [s.kind ?? t('hours.detail.noKind')]) : [],
);
const byTeacher = computed(() => tally((s) => s.teachers));

const tallies = computed(() => [
  { id: 'kind', title: t('hours.detail.byKind'), rows: byKind.value },
  { id: 'teacher', title: t('hours.detail.byTeacher'), rows: byTeacher.value },
].filter((block) => block.rows.length));

const lists = computed(() => [
  { id: 'upcoming', title: t('hours.planned'), rows: upcoming.value },
  { id: 'past', title: t('hours.done'), rows: past.value },
].filter((block) => block.rows.length));
</script>

<template>
  <div class="sheet-wrap" @keydown.esc.stop="emit('close')">
    <div class="backdrop" @click="emit('close')"></div>
    <div ref="sheet" class="sheet tinted" :style="tint" tabindex="-1" role="dialog" aria-modal="true" :aria-label="subject.name">
      <header class="head">
        <div>
          <h2 class="code">{{ subject.name }}</h2>
          <p v-if="subject.label" class="label">{{ subject.label }}</p>
        </div>
        <button class="close" type="button" :aria-label="t('feedback.close')" @click="emit('close')">✕</button>
      </header>

      <div
        class="bar"
        role="img"
        :aria-label="t('hours.progress', { done: formatMinutesSpan(subject.done.minutes), total: formatMinutesSpan(total) })"
      >
        <span class="bar-done" :style="{ width: `${share}%` }"></span>
      </div>
      <p class="figures">
        <span v-if="subject.done.courses" class="figure">
          <strong>{{ formatMinutesSpan(subject.done.minutes) }}</strong>
          {{ t('hours.doneShort', { n: subject.done.courses }) }}
        </span>
        <span v-if="subject.planned.courses" class="figure planned">
          <strong>{{ formatMinutesSpan(subject.planned.minutes) }}</strong>
          {{ t('hours.plannedShort', { n: subject.planned.courses }) }}
        </span>
      </p>

      <dl v-if="next" class="facts">
        <dt>{{ t('hours.detail.next') }}</dt>
        <dd>{{ formatDayDate(next.shownStart) }}, {{ formatTime(next.shownStart) }}</dd>
        <template v-if="last !== next">
          <dt>{{ t('hours.detail.last') }}</dt>
          <dd>{{ formatDayDate(last.shownStart) }}, {{ formatTime(last.shownStart) }}</dd>
        </template>
      </dl>
      <p v-else class="ended">{{ t('hours.detail.ended') }}</p>

      <section v-for="block in tallies" :key="block.id" class="block">
        <h3 class="block-title">{{ block.title }}</h3>
        <ul class="tally">
          <li v-for="row in block.rows" :key="row.key">
            <span class="tally-name">{{ row.key }}</span>
            <span class="tally-figures">
              <span v-if="row.done.courses" class="figure">
                <strong>{{ formatMinutesSpan(row.done.minutes) }}</strong>
                {{ t('hours.doneShort', { n: row.done.courses }) }}
              </span>
              <span v-if="row.planned.courses" class="figure planned">
                <strong>{{ formatMinutesSpan(row.planned.minutes) }}</strong>
                {{ t('hours.plannedShort', { n: row.planned.courses }) }}
              </span>
            </span>
          </li>
        </ul>
      </section>

      <section v-for="block in lists" :key="block.id" class="block">
        <h3 class="block-title">{{ block.title }}</h3>
        <ul class="sessions" :class="block.id">
          <li v-for="(session, i) in block.rows" :key="i">
            <span class="when">
              <span class="date">{{ formatDayDate(session.shownStart) }}</span>
              <span class="time">{{ formatTime(session.shownStart) }} – {{ formatTime(session.shownEnd) }}</span>
            </span>
            <span class="what">
              <span v-if="session.kind" class="tag">{{ session.kind }}</span>
              <span v-if="session.room" class="room">{{ session.room }}</span>
              <span v-if="session.teachers.length" class="teachers">{{ session.teachers.join(', ') }}</span>
            </span>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>

<style scoped>
.sheet-wrap {
  position: fixed;
  inset: 0;
  z-index: 10;
  display: grid;
  place-items: center;
  padding: 1rem;
  padding-top: calc(1rem + var(--safe-top));
  padding-bottom: calc(1rem + var(--safe-bottom));
}
.backdrop {
  position: absolute;
  inset: 0;
  background: color-mix(in srgb, var(--bg) 70%, transparent);
  backdrop-filter: blur(6px);
}
.sheet {
  position: relative;
  z-index: 1;
  width: min(30rem, 100%);
  max-height: min(88vh, 46rem);
  overflow-y: auto;
  padding: 1rem 1rem 1.1rem;
  background: color-mix(in srgb, var(--kind) var(--tint-bg), var(--bg-elevated));
  border: 1px solid color-mix(in srgb, var(--kind) 35%, var(--line));
  border-inline-start: 5px solid var(--kind);
  border-radius: var(--radius);
  box-shadow: 0 20px 50px rgb(0 0 0 / 0.3);
  animation: rise 0.18s ease-out;
  outline: none;
}
/* Sur téléphone, la fiche monte du bas de l'écran, là où le pouce la referme. */
@media (max-width: 599px) {
  .sheet-wrap { place-items: end stretch; padding: 0; }
  .sheet {
    width: 100%;
    padding-bottom: calc(1.2rem + var(--safe-bottom));
    border-inline-start-width: 1px;
    border-top: 5px solid var(--kind);
    border-radius: var(--radius) var(--radius) 0 0;
  }
}
@keyframes rise {
  from { transform: translateY(1rem); opacity: 0; }
  to { transform: none; opacity: 1; }
}

.head { display: flex; align-items: flex-start; justify-content: space-between; gap: 0.6rem; }
.code { margin: 0.15rem 0 0; font-size: 1.2rem; font-weight: 700; line-height: 1.25; }
.label { margin: 0.1rem 0 0; font-size: 0.9rem; color: var(--text-muted); overflow-wrap: anywhere; }
.close {
  flex: none;
  width: 2.2rem; height: 2.2rem;
  margin: -0.3rem -0.4rem 0 0;
  display: grid; place-items: center;
  font-size: 1.1rem;
  color: var(--text-muted);
  border-radius: 999px;
}
.close:hover { background: var(--bg-sunken); color: var(--text); }

.bar {
  height: 8px;
  margin: 0.8rem 0 0.4rem;
  overflow: hidden;
  background: color-mix(in srgb, var(--kind) 22%, transparent);
  border-radius: 999px;
}
.bar-done { display: block; height: 100%; background: var(--kind); border-radius: inherit; }

.figures {
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.2rem 0.8rem;
  font-size: 0.82rem;
}
.figure { color: var(--text-muted); font-variant-numeric: tabular-nums; }
.figure strong { color: var(--text); font-weight: 700; }
.figures .planned { margin-inline-start: auto; }

.facts {
  margin: 0.9rem 0 0;
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.35rem 0.9rem;
  align-items: baseline;
  font-size: 0.9rem;
}
.facts dt,
.block-title {
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
}
.facts dd { margin: 0; font-weight: 600; }
.facts dd::first-letter { text-transform: uppercase; }
.ended { margin: 0.9rem 0 0; font-size: 0.88rem; font-weight: 600; color: var(--text-muted); }

.block { margin-top: 1rem; }
.block-title { margin: 0 0 0.4rem; }

.tally, .sessions { list-style: none; margin: 0; padding: 0; }
/* Le nom sur sa ligne, les heures dessous : un nom long ne décale rien. */
.tally li {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  padding: 0.35rem 0;
  font-size: 0.85rem;
}
.tally li + li { border-top: 1px solid color-mix(in srgb, var(--kind) 18%, var(--line)); }
.tally-name { font-weight: 600; }
.tally-figures { display: flex; flex-wrap: wrap; gap: 0.1rem 0.8rem; font-size: 0.8rem; }
.tally-figures .planned { margin-inline-start: auto; }

.sessions li {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.15rem 0.8rem;
  padding: 0.4rem 0;
  font-size: 0.85rem;
}
.sessions li + li { border-top: 1px solid color-mix(in srgb, var(--kind) 18%, var(--line)); }
.sessions.past li { color: var(--text-muted); }
.when { display: flex; gap: 0.5rem; min-width: 11.5rem; font-variant-numeric: tabular-nums; }
.date { font-weight: 600; }
.date::first-letter { text-transform: uppercase; }
.what { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.2rem 0.5rem; min-width: 0; }
.tag {
  padding: 0 0.45rem;
  border-radius: 999px;
  font-size: 0.7rem;
  font-weight: 700;
  color: var(--kind);
  background: color-mix(in srgb, var(--kind) 22%, transparent);
}
.room { font-weight: 600; }
.teachers { color: var(--text-muted); overflow-wrap: anywhere; }
</style>
