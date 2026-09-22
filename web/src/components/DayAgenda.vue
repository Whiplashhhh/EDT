<script setup>
import { computed } from 'vue';
import EventCard from './EventCard.vue';
import CrousMenu from './CrousMenu.vue';
import { formatTime, minutesOfDay } from '../dates.js';

const props = defineProps({
  day: { type: String, required: true },
  events: { type: Array, default: () => [] },
  now: { type: Number, default: 0 },
});

/* Service du restaurant universitaire (11h15 → 13h45) : la pause qui recouvre
   cette plage reçoit le menu du Crous à la place du simple libellé de trou. */
const LUNCH_FROM = 11 * 60 + 15;
const LUNCH_TO = 13 * 60 + 45;

/** Minutes de recouvrement entre un trou et le service du midi. */
function lunchOverlap(from, to) {
  return Math.min(minutesOfDay(to), LUNCH_TO) - Math.max(minutesOfDay(from), LUNCH_FROM);
}

/** Insère un séparateur quand deux cours sont séparés par au moins 45 minutes. */
const rows = computed(() => {
  const out = [];
  props.events.forEach((event, index) => {
    const previous = props.events[index - 1];
    if (previous) {
      const gap = (new Date(event.start) - new Date(previous.end)) / 60_000;
      if (gap >= 15) out.push({ type: 'gap', key: `gap-${event.uid}`, from: previous.end, to: event.start, minutes: gap });
    }
    out.push({
      type: 'event',
      key: event.uid,
      event,
      minutes: (new Date(event.end) - new Date(event.start)) / 60_000,
    });
  });

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
  const first = props.events[0];
  const last = props.events[props.events.length - 1];
  if (first && minutesOfDay(first.start) > LUNCH_FROM) {
    out.unshift({ type: 'crous', key: 'crous-before' });
  } else if (last && minutesOfDay(last.end) < LUNCH_TO) {
    out.push({ type: 'crous', key: 'crous-after' });
  }

  return out;
});

const totalHours = computed(() => {
  const minutes = props.events.reduce((sum, e) => sum + (new Date(e.end) - new Date(e.start)) / 60_000, 0);
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
});

/* Hauteur proportionnelle : un cours de 2 h occupe deux fois la place d'un cours d'1 h. */
const PX_PER_MIN = 0.95;
const blockHeight = (minutes) => `${Math.round(minutes * PX_PER_MIN)}px`;
/* Les longues pauses sont plafonnées pour ne pas repousser la suite hors de l'écran. */
const gapHeight = (minutes) => `${Math.min(140, Math.max(26, Math.round(minutes * PX_PER_MIN)))}px`;

function gapLabel(minutes) {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h && m) return `${h} h ${String(m).padStart(2, '0')} de pause`;
  if (h) return `${h} h de pause`;
  return `${m} min de pause`;
}
</script>

<template>
  <section class="agenda" :aria-label="`Cours du ${day}`">
    <p v-if="events.length" class="summary">
      {{ events.length }} cours · {{ totalHours }} · {{ formatTime(events[0].start) }} → {{ formatTime(events[events.length - 1].end) }}
    </p>

    <ol v-if="events.length" class="list">
      <li
        v-for="row in rows"
        :key="row.key"
        :class="[row.type, { lunch: row.lunch }]"
        :style="row.lunch || row.type === 'crous' ? null : { minHeight: row.type === 'event' ? blockHeight(row.minutes) : gapHeight(row.minutes) }"
      >
        <EventCard v-if="row.type === 'event'" :event="row.event" :now="now" />
        <CrousMenu v-else-if="row.lunch || row.type === 'crous'" :day="day" />
        <p v-else class="gap-label">{{ gapLabel(row.minutes) }}</p>
      </li>
    </ol>

    <p v-else class="empty">
      <span class="emoji" aria-hidden="true">🌤️</span>
      Aucun cours ce jour-là.
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
.list > li.event { display: flex; }
.list > li.event > * { flex: 1; }
.list > li.gap {
  display: flex;
  align-items: center;
  /* Le trait pointillé montre le trou à l'échelle, comme sur la grille semaine. */
  border-left: 2px dashed var(--line);
  margin-left: 4.9rem;
}
.list > li.gap.lunch,
.list > li.crous {
  /* Le menu remplace le trait pointillé : il s'aligne sur les cartes de cours. */
  display: flex;
  border-left: none;
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
