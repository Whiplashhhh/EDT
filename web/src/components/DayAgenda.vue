<script setup>
import { computed } from 'vue';
import EventCard from './EventCard.vue';
import CrousMenu from './CrousMenu.vue';
import { formatTime, formatMinutesSpan, minutesOfDay } from '../dates.js';
import { t } from '../i18n.js';

const props = defineProps({
  day: { type: String, required: true },
  events: { type: Array, default: () => [] },
  now: { type: Number, default: 0 },
  /* Le menu du Crous accompagne la journée d'une classe ; sur l'emploi du temps
     d'une salle ou d'un enseignant, il n'a rien à y faire. */
  showMenu: { type: Boolean, default: true },
  context: { type: String, default: 'groups' },
});

/* Service du restaurant universitaire (11h15 → 13h45) : la pause qui recouvre
   cette plage reçoit le menu du Crous à la place du simple libellé de trou. */
const LUNCH_FROM = 11 * 60 + 15;
const LUNCH_TO = 13 * 60 + 45;

/** Minutes de recouvrement entre un trou et le service du midi. */
function lunchOverlap(from, to) {
  return Math.min(minutesOfDay(to), LUNCH_TO) - Math.max(minutesOfDay(from), LUNCH_FROM);
}

/**
 * Regroupe les cours qui se chevauchent. Deux TD simultanés dans deux salles
 * différentes forment un même bloc de la journée : les empiler l'un sous l'autre
 * ferait croire qu'ils se suivent, alors qu'il faut choisir entre les deux.
 */
const clusters = computed(() => {
  const sorted = [...props.events].sort(
    (a, b) => new Date(a.start) - new Date(b.start) || new Date(a.end) - new Date(b.end),
  );
  const out = [];
  for (const event of sorted) {
    const current = out[out.length - 1];
    // Un cours qui démarre avant la fin du bloc en cours le rejoint, côte à côte.
    if (current && new Date(event.start) < new Date(current.end)) {
      current.events.push(event);
      if (new Date(event.end) > new Date(current.end)) current.end = event.end;
    } else {
      out.push({ start: event.start, end: event.end, events: [event] });
    }
  }
  return out;
});

/* Hauteur proportionnelle : un cours de 2 h occupe deux fois la place d'un cours d'1 h. */
const PX_PER_MIN = 0.95;

/*
 * La classe tient la colonne : ses cours se suivent de haut en bas, comme dans la
 * journée telle qu'elle est vécue. Un TD et ses TP y comptent pour une seule
 * classe — BUT3-TD2-APP et BUT3-TD2-PA, ce sont les mêmes étudiants, séparés
 * seulement parce que le cours a été déposé à deux niveaux de l'arbre ADE. Faute
 * d'avoir cet arbre ici, c'est le nom qui le dit : son dernier segment est le
 * sous-groupe, ce qui précède est la classe. Deux cours réellement simultanés
 * restent côte à côte, la répartition en colonnes les sépare d'elle-même.
 */
function familyOf(group) {
  const parts = group.split('-');
  return parts.length >= 3 ? parts.slice(0, -1).join('-') : group;
}

/* Sans classe — deux enseignants dans la même salle —, c'est le nom du cours qui
   sert de repère. */
const columnKey = (event) => (event.groups?.length
  ? [...new Set(event.groups.map(familyOf))].sort().join(', ')
  : event.subject || '');

/**
 * Dispose les cours d'un bloc en grille : une colonne par classe, et une ligne par
 * tranche horaire. Une tranche vaut sa durée, mais s'agrandit si une carte a besoin
 * de plus de place : les proportions tiennent sans jamais rogner un libellé.
 */
function placeCluster(cluster) {
  const origin = new Date(cluster.start).getTime();
  const items = cluster.events.map((event) => ({
    event,
    from: (new Date(event.start).getTime() - origin) / 60_000,
    to: (new Date(event.end).getTime() - origin) / 60_000,
  }));

  // Une colonne par classe, et une colonne de plus si une classe se dédouble.
  const byClass = new Map();
  for (const item of items) {
    const key = columnKey(item.event);
    if (!byClass.has(key)) byClass.set(key, []);
    byClass.get(key).push(item);
  }
  const columns = [];
  for (const group of byClass.values()) {
    const lanes = [];
    for (const item of group) {
      let lane = lanes.find((candidate) => candidate.end <= item.from);
      if (!lane) { lane = { end: -Infinity, items: [] }; lanes.push(lane); }
      lane.items.push(item);
      lane.end = Math.max(lane.end, item.to);
    }
    columns.push(...lanes.map((lane) => lane.items));
  }

  /* Les lignes de la grille : les instants où un cours commence ou s'arrête
     découpent le bloc, et chaque tranche garde la hauteur de sa durée. */
  const marks = [...new Set(items.flatMap((item) => [item.from, item.to]))].sort((a, b) => a - b);
  const line = new Map(marks.map((at, index) => [at, index + 1]));

  const cards = [];
  columns.forEach((column, index) => {
    for (const item of column) {
      cards.push({
        event: item.event,
        style: {
          gridColumn: `${index + 1}`,
          gridRow: `${line.get(item.from)} / ${line.get(item.to)}`,
        },
      });
    }
  });

  return {
    cards,
    compact: columns.length > 1,
    grid: {
      gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))`,
      gridTemplateRows: marks.slice(1)
        .map((at, index) => `minmax(${Math.round((at - marks[index]) * PX_PER_MIN)}px, auto)`)
        .join(' '),
    },
  };
}

/** Insère un séparateur quand deux blocs sont séparés par au moins 15 minutes. */
const rows = computed(() => {
  const out = [];
  clusters.value.forEach((cluster, index) => {
    const previous = clusters.value[index - 1];
    if (previous) {
      const gap = (new Date(cluster.start) - new Date(previous.end)) / 60_000;
      if (gap >= 15) {
        out.push({
          type: 'gap',
          key: `gap-${cluster.events[0].uid}`,
          from: previous.end,
          to: cluster.start,
          minutes: gap,
        });
      }
    }
    out.push({
      type: 'event',
      key: cluster.events.map((event) => event.uid).join('+'),
      minutes: (new Date(cluster.end) - new Date(cluster.start)) / 60_000,
      /* Un cours seul reste dans le flux : il n'a personne avec qui s'aligner. */
      ...(cluster.events.length > 1
        ? placeCluster(cluster)
        : { cards: [{ event: cluster.events[0], style: null }], compact: false, grid: null }),
    });
  });

  if (!props.showMenu) return out;

  // Une seule pause porte le menu : celle qui déborde le plus sur le service.
  let lunch = null;
  for (const row of out) {
    if (row.type !== 'gap') continue;
    const overlap = lunchOverlap(row.from, row.to);
    if (overlap > 0 && (!lunch || overlap > lunch.overlap)) lunch = { row, overlap };
  }
  if (lunch) {
    lunch.row.lunch = true;
    return out;
  }

  /*
   * Sans trou à midi, le menu se pose au bord de la journée quand le service
   * reste accessible : avant un premier cours qui commence après l'ouverture,
   * sinon après un dernier cours qui finit avant la fermeture.
   */
  const first = clusters.value[0];
  const last = clusters.value[clusters.value.length - 1];
  if (first && minutesOfDay(first.start) > LUNCH_FROM) {
    out.unshift({ type: 'crous', key: 'crous-before' });
  } else if (last && minutesOfDay(last.end) < LUNCH_TO) {
    out.push({ type: 'crous', key: 'crous-after' });
  }

  return out;
});

const totalHours = computed(() =>
  formatMinutesSpan(props.events.reduce((sum, e) => sum + (new Date(e.end) - new Date(e.start)) / 60_000, 0)),
);

const blockHeight = (minutes) => `${Math.round(minutes * PX_PER_MIN)}px`;
/* Les longues pauses sont plafonnées pour ne pas repousser la suite hors de l'écran. */
const gapHeight = (minutes) => `${Math.min(140, Math.max(26, Math.round(minutes * PX_PER_MIN)))}px`;

const gapLabel = (minutes) => t('day.break', { duration: formatMinutesSpan(minutes) });

/* Un bloc de cours simultanés impose sa hauteur — c'est elle qui porte l'échelle
   des cartes ; partout ailleurs, la ligne s'étire si son contenu déborde. */
function rowStyle(row) {
  if (row.lunch || row.type === 'crous') return null;
  if (row.grid) return row.grid;
  return { minHeight: row.type === 'event' ? blockHeight(row.minutes) : gapHeight(row.minutes) };
}
</script>

<template>
  <section class="agenda" :aria-label="t('day.aria', { day })">
    <p v-if="events.length" class="summary">
      {{ t('day.courses', { n: events.length }) }} · {{ totalHours }} · {{ formatTime(clusters[0].start) }} → {{ formatTime(clusters[clusters.length - 1].end) }}
    </p>

    <ol v-if="events.length" class="list">
      <li
        v-for="row in rows"
        :key="row.key"
        :class="[row.type, { lunch: row.lunch, placed: row.grid }]"
        :style="rowStyle(row)"
      >
        <template v-if="row.type === 'event'">
          <EventCard
            v-for="item in row.cards"
            :key="item.event.uid"
            :event="item.event"
            :now="now"
            :context="context"
            :compact="row.compact"
            :style="item.style"
          />
        </template>
        <CrousMenu v-else-if="row.lunch || row.type === 'crous'" :day="day" />
        <p v-else class="gap-label">{{ gapLabel(row.minutes) }}</p>
      </li>
    </ol>

    <p v-else class="empty">
      <span class="emoji" aria-hidden="true">🌤️</span>
      {{ t('day.empty') }}
    </p>
  </section>
</template>

<style scoped>
.agenda { padding: 0 0.75rem 1.5rem; }
.summary {
  margin: 0.15rem 0 0.7rem;
  font-size: 0.82rem;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}
.list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.35rem; }
/* Les cours simultanés se partagent la largeur au lieu de s'empiler : une colonne
   par classe, et on voit d'un coup qu'il faut choisir entre elles. */
.list > li.event { display: flex; }
.list > li.event > * { flex: 1; }
/* Un bloc de cours simultanés devient une grille : les colonnes sont les classes,
   les lignes les tranches horaires, et chaque carte occupe la sienne. */
.list > li.event.placed { display: grid; gap: 2px 0.35rem; }
.list > li.gap {
  display: flex;
  align-items: center;
  /* Le trait pointillé montre le trou à l'échelle, comme sur la grille semaine. */
  border-inline-start: 2px dashed var(--line);
  margin-inline-start: 4.9rem;
}
.list > li.gap.lunch,
.list > li.crous {
  /* Le menu remplace le trait pointillé : il s'aligne sur les cartes de cours. */
  display: flex;
  border-inline-start: none;
  margin: 0.15rem 0;
}
.gap-label {
  margin: 0 0 0 0.6rem;
  font-size: 0.78rem;
  color: var(--text-muted);
}
.empty {
  margin: 2.5rem 0;
  text-align: center;
  color: var(--text-muted);
}
.emoji { display: block; font-size: 1.8rem; margin-bottom: 0.4rem; }
</style>
