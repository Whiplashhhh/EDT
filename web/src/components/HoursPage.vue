<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { api } from '../api.js';
import { courseStyle } from '../colors.js';
import { formatMinutesSpan, formatStamp } from '../dates.js';
import { errorMessage, t } from '../i18n.js';
import SubjectHoursDetail from './SubjectHoursDetail.vue';

/*
 * Bilan des heures d'une classe sur l'année : par ressource, ce qui est passé
 * et ce qu'ADE a déjà publié pour la suite. Les durées sont celles d'ADE — un
 * créneau compte pour 1 h 30, pas pour l'horaire réel affiché ailleurs.
 */
const props = defineProps({
  department: { type: String, required: true },
  resourceId: { type: Number, required: true },
  resourceName: { type: String, default: '' },
});
const emit = defineEmits(['close']);

const summary = ref(null);
const loading = ref(false);
const error = ref(null);
let controller = null;

async function load() {
  controller?.abort();
  controller = new AbortController();
  const { signal } = controller;
  loading.value = true;
  error.value = null;
  try {
    const result = await api.hours(props.department, props.resourceId, signal);
    if (!signal.aborted) summary.value = result;
  } catch (err) {
    if (signal.aborted) return;
    summary.value = null;
    error.value = errorMessage(err, 'hours.error');
  } finally {
    if (!signal.aborted) loading.value = false;
  }
}

onMounted(load);
onUnmounted(() => controller?.abort());
watch(() => [props.department, props.resourceId], () => {
  opened.value = null;
  load();
});

/** Une durée en heures, « 0 h » compris : « 0 min » se lirait comme une erreur. */
const span = (minutes) => (minutes ? formatMinutesSpan(minutes) : formatMinutesSpan(60).replace('1', '0'));

/** La ressource dont la fiche est ouverte, et l'instant qui sépare passé et à-venir. */
const opened = ref(null);
const openedAt = ref(0);
function openSubject(row) {
  openedAt.value = summary.value ? Date.parse(summary.value.now) : Date.now();
  opened.value = row;
}

const rows = computed(() =>
  (summary.value?.subjects ?? []).map((subject) => {
    const total = subject.done.minutes + subject.planned.minutes;
    return {
      ...subject,
      key: `${subject.free ? 'free' : 'code'}:${subject.name}`,
      total,
      share: total ? Math.round((subject.done.minutes / total) * 100) : 0,
      style: courseStyle({ subject: subject.name }),
    };
  }),
);

/*
 * Les ressources du programme d'abord ; les créneaux sans code (rentrée,
 * forum…) à part. Une formation qui ne code pas ses cours n'a que ceux-là :
 * ils forment alors la liste, sans titre.
 */
const sections = computed(() => {
  const coded = rows.value.filter((row) => !row.free);
  const free = rows.value.filter((row) => row.free);
  if (!coded.length) return free.length ? [{ id: 'all', title: null, rows: free }] : [];
  return [
    { id: 'coded', title: t('hours.subjects'), rows: coded },
    ...(free.length ? [{ id: 'free', title: t('hours.other'), rows: free }] : []),
  ];
});

const totals = computed(() => {
  const sum = (side) => rows.value.reduce((n, row) => n + row[side].minutes, 0);
  const done = sum('done');
  const planned = sum('planned');
  return { done, planned, all: done + planned };
});
</script>

<template>
  <section class="hours" :aria-label="t('hours.title')">
    <div class="hours-head">
      <button class="back" type="button" @click="emit('close')">
        <span aria-hidden="true">←</span>
        {{ t('hours.back') }}
      </button>
      <h2 class="title">{{ t('hours.title') }}</h2>
      <p class="subtitle">{{ resourceName }}</p>
    </div>

    <p v-if="error" class="banner error" role="status">{{ error }}</p>
    <!-- ADE en panne : le serveur ressert ce qu'il avait, on dit de quand. -->
    <p v-else-if="summary?.stale" class="banner" role="status">{{ t('app.adeDown', { time: formatStamp(summary.fetchedAt) }) }}</p>
    <p v-if="loading && !summary" class="banner" role="status">{{ t('app.loading') }}</p>

    <template v-if="summary">
      <dl class="totals">
        <div class="total">
          <dt>{{ t('hours.done') }}</dt>
          <dd>{{ span(totals.done) }}</dd>
        </div>
        <div class="total">
          <dt>{{ t('hours.planned') }}</dt>
          <dd>{{ span(totals.planned) }}</dd>
        </div>
        <div class="total">
          <dt>{{ t('hours.total') }}</dt>
          <dd>{{ span(totals.all) }}</dd>
        </div>
      </dl>

      <p v-if="!sections.length" class="empty">{{ t('hours.empty') }}</p>

      <section v-for="section in sections" :key="section.id" class="group" :aria-label="section.title ?? undefined">
        <h3 v-if="section.title" class="group-title">{{ section.title }}</h3>
        <ul class="list">
          <li v-for="row in section.rows" :key="row.key">
            <button type="button" class="row tinted" :style="row.style" @click="openSubject(row)">
              <span class="name-line">
                <span class="code">{{ row.name }}</span>
                <span v-if="row.label" class="label">{{ row.label }}</span>
              </span>
              <span
                class="bar"
                role="img"
                :aria-label="t('hours.progress', { done: span(row.done.minutes), total: span(row.total) })"
              >
                <span class="bar-done" :style="{ width: `${row.share}%` }"></span>
              </span>
              <!-- Rien de passé, ou plus rien à venir : on n'en parle pas. -->
              <span class="figures">
                <span v-if="row.done.courses" class="figure">
                  <strong>{{ span(row.done.minutes) }}</strong>
                  {{ t('hours.doneShort', { n: row.done.courses }) }}
                </span>
                <span v-if="row.planned.courses" class="figure planned">
                  <strong>{{ span(row.planned.minutes) }}</strong>
                  {{ t('hours.plannedShort', { n: row.planned.courses }) }}
                </span>
              </span>
            </button>
          </li>
        </ul>
      </section>

      <p class="note">{{ t('hours.note') }}</p>
    </template>

    <SubjectHoursDetail
      v-if="opened"
      :key="opened.key"
      :subject="opened"
      :department="department"
      :now="openedAt"
      @close="opened = null"
    />
  </section>
</template>

<style scoped>
.hours {
  flex: 1;
  width: 100%;
  max-width: 64rem;
  margin: 0 auto;
  padding: 0.6rem 0.85rem 1rem;
}

.hours-head { margin-bottom: 0.8rem; }
.back {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  margin-inline-start: -0.4rem;
  padding: 0.3rem 0.5rem;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--accent);
  border-radius: var(--radius-sm);
}
.back:hover { background: var(--accent-soft); }
/* La flèche suit le sens de lecture. */
:dir(rtl) .back span { display: inline-block; transform: scaleX(-1); }
.title { margin: 0.35rem 0 0; font-size: 1.15rem; font-weight: 700; letter-spacing: -0.01em; }
.subtitle { margin: 0.1rem 0 0; font-size: 0.85rem; color: var(--text-muted); }

.banner {
  margin: 0 0 0.7rem;
  padding: 0.55rem 0.7rem;
  font-size: 0.83rem;
  color: var(--text-muted);
  background: var(--bg-elevated);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
}
.banner.error { color: var(--danger); border-color: color-mix(in srgb, var(--danger) 40%, var(--line)); }

.totals {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.5rem;
  margin: 0 0 1rem;
}
.total {
  padding: 0.55rem 0.65rem;
  background: var(--bg-elevated);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
}
.total dt {
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.total dd {
  margin: 0.15rem 0 0;
  font-size: 1.05rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.group + .group { margin-top: 1.1rem; }
.group-title {
  margin: 0 0 0.45rem;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.totals { max-width: 40rem; }

/* Une colonne au téléphone ; deux ou trois côte à côte sur un écran large. */
.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(17rem, 100%), 1fr));
  gap: 0.5rem;
}

.row {
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  width: 100%;
  height: 100%;
  font: inherit;
  color: inherit;
  text-align: start;
  cursor: pointer;
  padding: 0.55rem 0.7rem 0.6rem;
  background: color-mix(in srgb, var(--kind) var(--tint-bg), var(--bg-elevated));
  border-inline-start: 3px solid var(--kind);
  border-radius: var(--radius-sm);
}
.row:hover { background: color-mix(in srgb, var(--kind) calc(var(--tint-bg) + 6%), var(--bg-elevated)); }
.row:focus-visible { outline: 2px solid var(--kind); outline-offset: 2px; }
.name-line { display: flex; align-items: baseline; gap: 0.45rem; min-width: 0; }
.code { font-weight: 700; font-size: 0.9rem; white-space: nowrap; }
.label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.85rem;
  color: var(--text-muted);
}

.bar {
  display: block;
  height: 6px;
  margin: 0.45rem 0 0.35rem;
  overflow: hidden;
  background: color-mix(in srgb, var(--kind) 22%, transparent);
  border-radius: 999px;
}
.bar-done { display: block; height: 100%; background: var(--kind); border-radius: inherit; }

/* La durée au-dessus, le détail dessous : les cartes d'une grille restent alignées. */
.figures {
  display: flex;
  justify-content: space-between;
  gap: 0.8rem;
  font-size: 0.75rem;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}
.figure { display: flex; flex-direction: column; }
.figure strong { color: var(--text); font-size: 0.95rem; font-weight: 700; }
.figure.planned { margin-inline-start: auto; text-align: end; align-items: flex-end; }

.empty { margin: 1rem 0; text-align: center; color: var(--text-muted); }
.note { margin: 0.9rem 0 0; font-size: 0.75rem; line-height: 1.45; color: var(--text-muted); }
</style>
