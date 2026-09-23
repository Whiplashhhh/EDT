<script setup>
import { computed } from 'vue';
import {
  addDays, dayNumber, formatDayShort, formatTime,
  minutesOfDay, mondayOf, today,
} from '../dates.js';
import { defaultRangeOf, snapRange, ticksBetween } from '../slots.js';
import { courseStyle } from '../colors.js';

const props = defineProps({
  focused: { type: String, required: true },
  /* Le département fixe la graduation de l'axe : ses créneaux, à défaut les heures. */
  department: { type: String, default: '' },
  eventsByDay: { type: Map, required: true },
  now: { type: Number, default: 0 },
  /* Ce qu'on consulte. Sur l'emploi du temps d'un enseignant, répéter son nom
     sur chaque bloc n'apprend rien : c'est la classe qui manque. */
  context: { type: String, default: 'groups' },
});
const emit = defineEmits(['select']);

/** Hauteur d'une heure, en pixels : c'est elle qui rend les durées lisibles. */
const PX_PER_MIN = 56 / 60;
/**
 * Retrait vertical de chaque bloc. Le contour fait déjà la séparation :
 * un cheveu suffit pour que deux cours collés ne se confondent pas.
 */
const GUTTER = 1;
/** Plage affichée par défaut quand la semaine est vide, faute de créneaux connus. */
const DEFAULT_RANGE = { from: 8 * 60, to: 18 * 60 };

const days = computed(() => {
  const monday = mondayOf(props.focused);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i))
    // Un week-end vide n'apporte rien : on ne l'affiche que s'il contient des cours.
    .filter((day, index) => index < 5 || (props.eventsByDay.get(day) || []).length > 0);
});

const weekEvents = computed(() => days.value.flatMap((day) => props.eventsByDay.get(day) || []));

/** Bornes de la grille, élargies jusqu'aux graduations qui encadrent les cours. */
const range = computed(() => {
  if (!weekEvents.value.length) return defaultRangeOf(props.department) || DEFAULT_RANGE;
  let from = Infinity;
  let to = -Infinity;
  for (const event of weekEvents.value) {
    from = Math.min(from, minutesOfDay(event.start));
    // Un cours qui finit à minuit est ramené en fin de journée plutôt qu'à 0 h.
    const end = minutesOfDay(event.end) || 24 * 60;
    to = Math.max(to, end);
  }
  return snapRange(props.department, from, to);
});

const ticks = computed(() => ticksBetween(props.department, range.value.from, range.value.to));

const bodyHeight = computed(() => (range.value.to - range.value.from) * PX_PER_MIN);

/**
 * Place les cours d'une journée : position et hauteur proportionnelles à l'horaire,
 * et répartition en colonnes quand deux cours se chevauchent.
 */
function layout(day) {
  const events = [...(props.eventsByDay.get(day) || [])]
    .map((event) => ({
      event,
      from: minutesOfDay(event.start),
      to: minutesOfDay(event.end) || 24 * 60,
    }))
    .sort((a, b) => a.from - b.from || a.to - b.to);

  const placed = [];
  let cluster = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    const lanes = [];
    for (const item of cluster) {
      let lane = lanes.findIndex((end) => end <= item.from);
      if (lane < 0) { lane = lanes.length; lanes.push(0); }
      lanes[lane] = item.to;
      item.lane = lane;
    }
    for (const item of cluster) item.lanes = lanes.length;
    placed.push(...cluster);
    cluster = [];
    clusterEnd = -Infinity;
  };

  for (const item of events) {
    if (cluster.length && item.from >= clusterEnd) flush();
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.to);
  }
  if (cluster.length) flush();

  return placed.map((item) => {
    const minutes = Math.max(15, item.to - item.from);
    return {
      event: item.event,
      minutes: item.to - item.from,
      narrow: item.lanes > 1,
      style: {
        // GUTTER creuse un écart visible entre deux cours qui s'enchaînent.
        top: `${(item.from - range.value.from) * PX_PER_MIN + GUTTER}px`,
        height: `${minutes * PX_PER_MIN - 2 * GUTTER}px`,
        left: `${(item.lane / item.lanes) * 100}%`,
        width: `${100 / item.lanes}%`,
      },
    };
  });
}

const columns = computed(() => days.value.map((day) => ({ day, blocks: layout(day) })));

/** Position du trait « maintenant », uniquement si le jour est dans la semaine affichée. */
const nowLine = computed(() => {
  const iso = today();
  if (!props.now || !days.value.includes(iso)) return null;
  const minutes = minutesOfDay(new Date(props.now).toISOString());
  if (minutes < range.value.from || minutes > range.value.to) return null;
  return { day: iso, top: `${(minutes - range.value.from) * PX_PER_MIN}px` };
});

const peopleOf = (event) =>
  (props.context === 'teachers' ? event.groups : event.teachers || []).join(', ');
</script>

<template>
  <div class="scroller">
    <div class="grid" :style="{ '--cols': days.length, '--body-h': `${bodyHeight}px` }">
      <div class="head-corner"></div>
      <button
        v-for="day in days"
        :key="`h-${day}`"
        type="button"
        class="col-head"
        :class="{ today: day === today() }"
        @click="emit('select', day)"
      >
        <span class="name">{{ formatDayShort(day) }}</span>
        <span class="num">{{ dayNumber(day) }}</span>
      </button>

      <div class="axis">
        <span
          v-for="tick in ticks"
          :key="tick.at"
          class="axis-hour"
          :style="{ top: `${(tick.at - range.from) * PX_PER_MIN}px` }"
        >{{ tick.label }}</span>
      </div>

      <div
        v-for="column in columns"
        :key="column.day"
        class="col"
        :class="{ today: column.day === today() }"
      >
        <div
          v-for="tick in ticks"
          :key="`l-${tick.at}`"
          class="hour-line"
          :style="{ top: `${(tick.at - range.from) * PX_PER_MIN}px` }"
        ></div>

        <article
          v-for="block in column.blocks"
          :key="block.event.uid"
          class="block tinted"
          :class="{ tiny: block.minutes < 55, small: block.minutes < 85, narrow: block.narrow }"
          :style="[block.style, courseStyle(block.event)]"
        >
          <span class="hours">
            <!-- Une colonne dédoublée est trop étroite pour la plage complète. -->
            <template v-if="block.narrow">{{ formatTime(block.event.start) }}</template>
            <template v-else>{{ formatTime(block.event.start) }} – {{ formatTime(block.event.end) }}</template>
            <b v-if="block.event.kind" class="tag">{{ block.event.kind }}</b>
          </span>
          <span class="title">
            {{ block.event.subject }}
            <b v-if="block.event.kind" class="tag inline">{{ block.event.kind }}</b>
          </span>
          <b v-if="block.event.room" class="room">{{ block.event.room }}</b>
          <span v-if="peopleOf(block.event)" class="teacher">{{ peopleOf(block.event) }}</span>
        </article>

        <div
          v-if="nowLine && nowLine.day === column.day"
          class="now"
          :style="{ top: nowLine.top }"
          aria-hidden="true"
        ></div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.scroller { overflow-x: auto; padding: 0 0.75rem 1.5rem; }

.grid {
  display: grid;
  grid-template-columns: 2.9rem repeat(var(--cols), minmax(5.4rem, 1fr));
  grid-template-rows: auto var(--body-h);
  column-gap: 0.3rem;
  min-width: 100%;
}

.head-corner { border-bottom: 1px solid var(--line); }
.col-head {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 0.3rem;
  padding: 0.35rem 0;
  border-bottom: 1px solid var(--line);
}
.name { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); }
.num { font-weight: 650; font-variant-numeric: tabular-nums; }
.col-head.today .num { color: var(--accent); }

.axis { position: relative; }
.axis-hour {
  position: absolute;
  right: 0.3rem;
  transform: translateY(-0.5em);
  font-size: 0.68rem;
  font-variant-numeric: tabular-nums;
  color: var(--text-muted);
}

.col { position: relative; }
.col.today { background: color-mix(in srgb, var(--accent) 7%, transparent); border-radius: 8px; }

.hour-line {
  position: absolute;
  left: 0;
  right: 0;
  height: 1px;
  background: var(--line);
  opacity: 0.6;
}

.block {
  position: absolute;
  display: flex;
  flex-direction: column;
  gap: 0.05rem;
  overflow: hidden;
  padding: 0.25rem 0.3rem;
  background: color-mix(in srgb, var(--kind) var(--tint-bg), var(--bg-elevated));
  /* Contour dans la couleur de la ressource : deux cours voisins restent distincts
     même quand leurs teintes sont proches. */
  border: 1px solid color-mix(in srgb, var(--kind) 55%, transparent);
  border-left: 3px solid var(--kind);
  border-radius: 6px;
  font-size: 0.72rem;
  line-height: 1.2;
}
.hours { font-variant-numeric: tabular-nums; font-size: 0.65rem; color: var(--text-muted); }
.tag {
  margin-left: 0.3rem;
  font-size: 0.62rem;
  font-weight: 800;
  letter-spacing: 0.04em;
  color: var(--kind);
}
/* Le type ne se lit sur le titre que si la ligne d'horaires est masquée. */
.tag.inline { display: none; }
.block.tiny .tag.inline { display: inline; }
.title { font-weight: 650; overflow-wrap: anywhere; }
/* La salle est l'information qu'on cherche en urgence : elle se détache. */
.room {
  align-self: flex-start;
  max-width: 100%;
  margin-top: 0.1rem;
  padding: 0.02rem 0.28rem;
  font-size: 0.76rem;
  font-weight: 750;
  color: var(--text);
  background: color-mix(in srgb, var(--kind) 30%, transparent);
  border-radius: 4px;
  overflow-wrap: anywhere;
}
.teacher { color: var(--text-muted); overflow-wrap: anywhere; }

/* Quand la place manque, on sacrifie l'enseignant puis l'horaire — jamais la salle. */
.block.small .teacher,
.block.narrow .teacher { display: none; }
.block.tiny .hours { display: none; }
.block.narrow .room { font-size: 0.7rem; }

.now {
  position: absolute;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--danger);
  border-radius: 2px;
}
.now::before {
  content: '';
  position: absolute;
  left: -3px;
  top: -2px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--danger);
}
</style>
