<script setup>
import { computed } from 'vue';
import { formatTime, formatDuration, formatMinutesSpan } from '../dates.js';
import { t } from '../i18n.js';
import { courseStyle } from '../colors.js';

const props = defineProps({
  event: { type: Object, required: true },
  now: { type: Number, default: 0 },
});

const tint = computed(() => courseStyle(props.event));

const state = computed(() => {
  const start = new Date(props.event.start).getTime();
  const end = new Date(props.event.end).getTime();
  if (props.now >= end) return 'past';
  if (props.now >= start) return 'now';
  return 'upcoming';
});

const remaining = computed(() => {
  if (state.value !== 'now') return null;
  const minutes = Math.max(1, Math.round((new Date(props.event.end).getTime() - props.now) / 60_000));
  return t('card.remaining', { duration: formatMinutesSpan(minutes) });
});
</script>

<template>
  <article class="card tinted" :class="state" :style="tint">
    <div class="hours">
      <time :datetime="event.start">{{ formatTime(event.start) }}</time>
      <span class="dash" aria-hidden="true"></span>
      <time :datetime="event.end">{{ formatTime(event.end) }}</time>
    </div>
    <div class="body">
      <h3 class="subject">{{ event.subject }}</h3>
      <p class="meta">
        <b v-if="event.room" class="room">{{ event.room }}</b>
        <span v-if="event.kind" class="tag">{{ event.kind }}</span>
        <span class="duration">{{ formatDuration(event.start, event.end) }}</span>
      </p>
      <p v-if="event.teachers?.length || event.groups?.length" class="people">
        <span v-if="event.teachers?.length" class="teachers">{{ event.teachers.join(', ') }}</span>
        <span v-if="event.teachers?.length && event.groups?.length" aria-hidden="true"> · </span>
        <span v-if="event.groups?.length" class="groups">{{ event.groups.join(', ') }}</span>
      </p>
      <p v-if="remaining" class="live">{{ remaining }}</p>
    </div>
  </article>
</template>

<style scoped>
.card {
  display: grid;
  grid-template-columns: 4.6rem 1fr;
  gap: 0 0.85rem;
  align-items: start;
  padding: 0.85rem 0.95rem;
  background: color-mix(in srgb, var(--kind) var(--tint-bg), var(--bg-elevated));
  border: 1px solid color-mix(in srgb, var(--kind) 28%, var(--line));
  /* La barre de couleur court sur toute la hauteur : une bordure, pas un bloc
     enfermé dans le padding vertical de la carte. */
  border-left: 4px solid var(--kind);
  border-radius: var(--radius);
  overflow: hidden;
}
.card.past { opacity: 0.52; }
.card.now { border-color: var(--kind); box-shadow: 0 0 0 1px var(--kind); }

.hours {
  padding-top: 0.1rem;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  font-variant-numeric: tabular-nums;
  font-size: 0.95rem;
  color: var(--text-muted);
}
.hours time:first-child { color: var(--text); font-weight: 600; }
.dash { width: 1px; height: 0.5rem; margin: 0.15rem 0 0.15rem 0.55rem; background: var(--line); }

.subject { margin: 0; font-size: 1.02rem; font-weight: 650; line-height: 1.25; overflow-wrap: anywhere; }

.meta {
  margin: 0.3rem 0 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.85rem;
  color: var(--text-muted);
}
.tag {
  padding: 0.05rem 0.4rem;
  border-radius: 999px;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.03em;
  color: var(--kind);
  background: color-mix(in srgb, var(--kind) 22%, transparent);
}
/* La salle est l'information qu'on cherche en urgence : elle se détache. */
.room {
  padding: 0.1rem 0.4rem;
  font-size: 0.95rem;
  font-weight: 750;
  color: var(--text);
  background: color-mix(in srgb, var(--kind) 30%, transparent);
  border-radius: 6px;
  overflow-wrap: anywhere;
}

.people { margin: 0.25rem 0 0; font-size: 0.85rem; color: var(--text-muted); overflow-wrap: anywhere; }
.teachers { color: var(--text); font-weight: 500; }
.groups { opacity: 0.85; }
.live { margin: 0.35rem 0 0; font-size: 0.8rem; font-weight: 600; color: var(--kind); }
</style>
