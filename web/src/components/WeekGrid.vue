<script setup>
import { computed, onMounted, ref } from 'vue';
import {
  addDays, dayNumber, formatDayShort, formatMinutes, formatTime,
  minutesOfDay, mondayOf, today,
} from '../dates.js';
import { breaksOf, defaultRangeOf, snapRange, ticksBetween } from '../slots.js';
import { courseStyle } from '../colors.js';
import { departmentTag } from '../departments.js';

const props = defineProps({
  focused: { type: String, required: true },
  /* Le département fixe la graduation de l'axe : ses créneaux, à défaut les heures. */
  department: { type: String, default: '' },
  eventsByDay: { type: Map, required: true },
  now: { type: Number, default: 0 },
  /* Ce qu'on consulte. Sur l'emploi du temps d'un enseignant, répéter son nom
     sur chaque bloc n'apprend rien : c'est la classe qui manque. */
  context: { type: String, default: 'groups' },
  /**
   * Comparaison : une colonne par emploi du temps, toutes pour le jour `focused`,
   * sur le même axe horaire — un trou à gauche se lit en face de ce qui se
   * passe à droite. Chaque source porte `key`, `eventsByDay` et `context` ;
   * l'en-tête de colonne est laissé à l'emplacement `head`.
   */
  sources: { type: Array, default: null },
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
/**
 * Hauteur d'un inter-cours, en pixels. Le déplacer n'est pas du temps de cours :
 * l'étirer à l'échelle de la journée ne ferait qu'éloigner les blocs pour rien.
 * Les quelques minutes d'un changement de salle disparaissent, les vraies pauses
 * gardent un liseré qui les signale sans creuser la colonne.
 */
const BREAK_PX = (minutes) => (minutes <= 10 ? 0 : 5);
/** En deçà, deux graduations sont trop proches pour porter chacune leur heure. */
const LABEL_MIN_PX = 13;

const days = computed(() => {
  const monday = mondayOf(props.focused);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i))
    // Un week-end vide n'apporte rien : on ne l'affiche que s'il contient des cours.
    .filter((day, index) => index < 5 || (props.eventsByDay.get(day) || []).length > 0);
});

const columnsOf = computed(() => (props.sources
  ? props.sources.map((source) => ({
    key: source.key,
    day: props.focused,
    events: source.eventsByDay.get(props.focused) || [],
    context: source.context,
    source,
  }))
  : days.value.map((day) => ({ key: day, day, events: props.eventsByDay.get(day) || [], context: props.context }))));

const overlaps = (a, b) => new Date(a.start) < new Date(b.end) && new Date(b.start) < new Date(a.end);

/**
 * Cours communs à toutes les colonnes comparées : la même séance ADE — même
 * identifiant, mêmes horaires —, suivie ensemble par les deux classes. Ils
 * s'affichent en un seul bloc qui traverse les colonnes. Un cours qui en
 * chevauche un autre d'un côté reste dédoublé : un bloc pleine largeur le
 * recouvrirait.
 */
const shared = computed(() => {
  const out = new Map();
  const [first, ...rest] = props.sources ? columnsOf.value : [];
  if (!rest.length) return out;
  for (const event of first.events) {
    const twins = rest.map((column) => column.events.find((other) => other.uid === event.uid));
    if (twins.some((twin) => !twin || twin.start !== event.start || twin.end !== event.end)) continue;
    const crowded = columnsOf.value.some((column) =>
      column.events.some((other) => other.uid !== event.uid && overlaps(other, event)));
    if (!crowded) out.set(event.uid, event);
  }
  return out;
});

const shownDays = computed(() => [...new Set(columnsOf.value.map((column) => column.day))]);

const weekEvents = computed(() => columnsOf.value.flatMap((column) => column.events));

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

/** Les inter-cours visibles, dans l'ordre : ce sont eux qui déforment l'échelle. */
const breaks = computed(() => breaksOf(props.department)
  .filter((pause) => pause.from >= range.value.from && pause.to <= range.value.to));

/**
 * Ordonnée d'un instant, en pixels depuis le haut de la grille. Proportionnelle au
 * temps partout, sauf dans les inter-cours : chacun est ramené à sa hauteur fixe,
 * et la journée se resserre d'autant.
 */
function y(minutes) {
  let px = (minutes - range.value.from) * PX_PER_MIN;
  for (const pause of breaks.value) {
    if (minutes <= pause.from) break;
    const length = pause.to - pause.from;
    const inside = Math.min(minutes, pause.to) - pause.from;
    px -= inside * PX_PER_MIN - (inside / length) * BREAK_PX(length);
  }
  return px;
}

/* Une graduation perd son heure quand la suivante la serre de trop près : le trait
   reste — c'est lui qui borne le créneau —, l'heure passe à la suivante. */
const ticks = computed(() => {
  const marks = ticksBetween(props.department, range.value.from, range.value.to);
  const tops = marks.map(y);
  return marks.map((at, i) => ({
    at,
    top: tops[i],
    label: tops[i + 1] - tops[i] < LABEL_MIN_PX ? '' : formatMinutes(at),
  }));
});

const bodyHeight = computed(() => y(range.value.to));

/**
 * Place les cours d'une journée : position et hauteur proportionnelles à l'horaire,
 * et répartition en colonnes quand deux cours se chevauchent.
 */
function layout(dayEvents) {
  const events = [...dayEvents]
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
    const height = Math.max(y(item.to) - y(item.from), 15 * PX_PER_MIN);
    return {
      event: item.event,
      minutes: item.to - item.from,
      narrow: item.lanes > 1,
      style: {
        // GUTTER creuse un écart visible entre deux cours qui s'enchaînent.
        top: `${y(item.from) + GUTTER}px`,
        height: `${height - 2 * GUTTER}px`,
        insetInlineStart: `${(item.lane / item.lanes) * 100}%`,
        width: `${100 / item.lanes}%`,
      },
    };
  });
}

/*
 * Un cours commun n'est placé que dans la première colonne, et s'y élargit par
 * dessus les suivantes — écarts entre colonnes compris.
 */
const COLUMN_GAP_REM = 0.3;
const columns = computed(() => columnsOf.value.map((column, index) => {
  const own = column.events.filter((event) => !shared.value.has(event.uid));
  const blocks = layout(index === 0 ? [...own, ...shared.value.values()] : own);
  const count = columnsOf.value.length;
  for (const block of blocks) {
    if (!shared.value.has(block.event.uid)) continue;
    block.shared = true;
    block.style.width = `calc(${count * 100}% + ${(count - 1) * COLUMN_GAP_REM}rem)`;
  }
  return { ...column, blocks };
}));

/** Position du trait « maintenant », uniquement si le jour est dans la semaine affichée. */
const nowLine = computed(() => {
  const iso = today();
  if (!props.now || !shownDays.value.includes(iso)) return null;
  const minutes = minutesOfDay(new Date(props.now).toISOString());
  if (minutes < range.value.from || minutes > range.value.to) return null;
  return { day: iso, top: `${y(minutes)}px` };
});

/*
 * Sur téléphone, la fin de la semaine déborde : on ouvre la grille sur
 * aujourd'hui plutôt que sur un lundi déjà passé.
 */
const scroller = ref(null);
onMounted(() => {
  const el = scroller.value;
  const head = el?.querySelector('.col-head.today');
  if (!head || el.scrollWidth <= el.clientWidth) return;
  // La colonne du jour vient se ranger juste après l'axe des heures, qui reste en place.
  const axisEnd = el.querySelector('.axis').getBoundingClientRect().right;
  el.scrollLeft += head.getBoundingClientRect().left - axisEnd;
});

/* Une salle ou un enseignant sert plusieurs formations : on dit laquelle. */
const deptOf = (event, context) => (context === 'groups' ? '' : departmentTag(event.department));

/* Pour un enseignant ou des ressources, c'est la classe qui distingue deux séances. */
const peopleOf = (event, context) =>
  (context === 'teachers' || context === 'subjects' ? event.groups : event.teachers || []).join(', ');
</script>

<template>
  <div ref="scroller" class="scroller">
    <div class="grid" :class="{ compare: sources }" :style="{ '--cols': columns.length, '--body-h': `${bodyHeight}px` }">
      <div class="head-corner"></div>
      <template v-if="sources">
        <div v-for="column in columns" :key="`h-${column.key}`" class="col-head source">
          <slot name="head" :source="column.source" />
        </div>
      </template>
      <template v-else>
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
      </template>

      <div class="axis">
        <span
          v-for="tick in ticks"
          :key="tick.at"
          class="axis-hour"
          :style="{ top: `${tick.top}px` }"
        >{{ tick.label }}</span>
      </div>

      <div
        v-for="column in columns"
        :key="column.key"
        class="col"
        :class="{ today: !sources && column.day === today() }"
      >
        <div
          v-for="tick in ticks"
          :key="`l-${tick.at}`"
          class="hour-line"
          :style="{ top: `${tick.top}px` }"
        ></div>

        <article
          v-for="block in column.blocks"
          :key="block.event.uid"
          class="block tinted"
          :class="{ tiny: block.minutes < 55, small: block.minutes < 85, narrow: block.narrow, shared: block.shared }"
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
          <span v-if="block.event.room || deptOf(block.event, column.context)" class="where">
            <b v-if="block.event.room" class="room">{{ block.event.room }}</b>
            <span v-if="deptOf(block.event, column.context)" class="dept">{{ deptOf(block.event, column.context) }}</span>
          </span>
          <span v-if="peopleOf(block.event, column.context)" class="teacher">{{ peopleOf(block.event, column.context) }}</span>
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
  /* Même valeur que COLUMN_GAP_REM : un cours commun enjambe cet écart. */
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
/* L'en-tête d'une colonne comparée porte un nom de classe : il doit pouvoir
   rétrécir plutôt qu'élargir la colonne. */
.col-head.source { min-width: 0; justify-content: stretch; padding: 0.25rem 0; }

/* Deux colonnes seulement : chacune a la place d'un texte un peu plus grand. */
.grid.compare .block { font-size: 0.8rem; padding: 0.3rem 0.4rem; }
.grid.compare .hours { font-size: 0.7rem; }

/* Quand la grille défile en largeur, les heures restent en place. */
.axis,
.head-corner {
  position: sticky;
  inset-inline-start: 0;
  z-index: 3;
  background: var(--bg);
  /* Couvre aussi la marge du défileur, où passeraient sinon les cours glissant sous l'axe. */
  box-shadow: -0.75rem 0 0 var(--bg);
}
.axis-hour {
  position: absolute;
  inset-inline-end: 0.3rem;
  transform: translateY(-0.5em);
  font-size: 0.68rem;
  font-variant-numeric: tabular-nums;
  color: var(--text-muted);
}

.col { position: relative; }
.col.today { background: color-mix(in srgb, var(--accent) 7%, transparent); border-radius: 8px; }

.hour-line {
  position: absolute;
  inset-inline: 0;
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
  border-inline-start: 3px solid var(--kind);
  border-radius: 6px;
  font-size: 0.72rem;
  line-height: 1.2;
}
/* Posé sur la colonne voisine : il doit passer devant ses graduations. */
.block.shared { z-index: 1; }
/* Il a toute la largeur : un cours court range horaire, titre et salle sur une
   même ligne plutôt que de rogner la salle en bas du bloc. */
.block.shared.small { flex-direction: row; flex-wrap: wrap; align-items: baseline; column-gap: 0.45rem; }
.block.shared.tiny .hours { display: inline; }
.block.shared.tiny .tag.inline { display: none; }
.block.shared.small .where { margin-top: 0; }
.hours { font-variant-numeric: tabular-nums; font-size: 0.65rem; color: var(--text-muted); }
.tag {
  margin-inline-start: 0.3rem;
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
.where {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.2rem;
  margin-top: 0.1rem;
}
.room {
  max-width: 100%;
  padding: 0.02rem 0.28rem;
  font-size: 0.76rem;
  font-weight: 750;
  color: var(--text);
  background: color-mix(in srgb, var(--kind) 30%, transparent);
  border-radius: 4px;
  overflow-wrap: anywhere;
}
.dept {
  padding: 0 0.25rem;
  border: 1px solid var(--line);
  border-radius: 999px;
  font-size: 0.56rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}
.teacher { color: var(--text-muted); overflow-wrap: anywhere; }

/* Quand la place manque, on sacrifie l'enseignant puis l'horaire — jamais la salle. */
.block.small .teacher,
.block.narrow .teacher { display: none; }
.block.tiny .hours { display: none; }
.block.narrow .room { font-size: 0.7rem; }

/*
 * Semaine sur téléphone : des colonnes assez larges pour lire un cours, quitte à
 * faire défiler la fin de la semaine. L'horaire, que l'axe donne déjà, cède la
 * place au titre et à la salle, et un mot trop long se coupe à une syllabe
 * plutôt qu'au hasard d'une lettre.
 */
@media (max-width: 699px) {
  .scroller:has(.grid:not(.compare)) { padding-inline: 0.4rem; }
  .grid:not(.compare) {
    grid-template-columns: 2.3rem repeat(var(--cols), minmax(5.6rem, 1fr));
    column-gap: 0.2rem;
  }
  .grid:not(.compare) .axis-hour { font-size: 0.6rem; inset-inline-end: 0.2rem; }
  .grid:not(.compare) .block { padding: 0.2rem 0.25rem; }
  .grid:not(.compare) .hours { display: none; }
  .grid:not(.compare) .tag.inline { display: inline; }
  .grid:not(.compare) .title,
  .grid:not(.compare) .room,
  .grid:not(.compare) .teacher { overflow-wrap: break-word; hyphens: auto; }
}

.now {
  position: absolute;
  z-index: 2;
  inset-inline: 0;
  height: 2px;
  background: var(--danger);
  border-radius: 2px;
}
.now::before {
  content: '';
  position: absolute;
  inset-inline-start: -3px;
  top: -2px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--danger);
}
</style>
