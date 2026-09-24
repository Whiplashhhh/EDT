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
      events: cluster.events,
      /* La hauteur suit la durée du bloc entier : des cours simultanés de durées
         différentes occupent la place du plus long, sans se décaler entre eux. */
      minutes: (new Date(cluster.end) - new Date(cluster.start)) / 60_000,
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

/* Hauteur proportionnelle : un cours de 2 h occupe deux fois la place d'un cours d'1 h. */
const PX_PER_MIN = 0.95;
const blockHeight = (minutes) => `${Math.round(minutes * PX_PER_MIN)}px`;
/* Les longues pauses sont plafonnées pour ne pas repousser la suite hors de l'écran. */
const gapHeight = (minutes) => `${Math.min(140, Math.max(26, Math.round(minutes * PX_PER_MIN)))}px`;

const gapLabel = (minutes) => t('day.break', { duration: formatMinutesSpan(minutes) });
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
        :class="[row.type, { lunch: row.lunch }]"
        :style="row.lunch || row.type === 'crous' ? null : { minHeight: row.type === 'event' ? blockHeight(row.minutes) : gapHeight(row.minutes) }"
      >
        <template v-if="row.type === 'event'">
          <EventCard
            v-for="event in row.events"
            :key="event.uid"
            :event="event"
            :now="now"
            :context="context"
            :compact="row.events.length > 1"
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
/* Les cours simultanés se partagent la largeur au lieu de s'empiler : côte à côte,
   on voit d'un coup qu'il faut choisir entre eux. */
.list > li.event { display: flex; gap: 0.35rem; }
.list > li.event > * { flex: 1 1 0; min-width: 0; }
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
