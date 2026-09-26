<script setup>
import { computed } from 'vue';
import { formatTime, formatDuration, formatMinutesSpan } from '../dates.js';
import { t } from '../i18n.js';
import { courseStyle } from '../colors.js';
import { departmentTag } from '../departments.js';

const props = defineProps({
  event: { type: Object, required: true },
  now: { type: Number, default: 0 },
  /* Ce qu'on consulte — à ne pas confondre avec `event.kind`, le type de séance.
     Sur l'emploi du temps d'un enseignant, son nom est déjà dans l'en-tête et
     n'a pas besoin d'être répété sur chaque carte. */
  context: { type: String, default: 'groups' },
  /* Carte réduite : deux cours simultanés se partagent la largeur, la colonne
     d'horaires n'y tient plus et passe au-dessus du titre. */
  compact: { type: Boolean, default: false },
});

const showTeachers = computed(() => props.context !== 'teachers' && props.event.teachers?.length > 0);
const showGroups = computed(() => props.event.groups?.length > 0);
/* Une salle ou un enseignant sert plusieurs formations : on dit laquelle. */
const dept = computed(() => (props.context === 'groups' ? '' : departmentTag(props.event.department)));

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
  <article class="card tinted" :class="[state, { compact }]" :style="tint">
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
        <span v-if="dept" class="dept">{{ dept }}</span>
        <span class="duration">{{ formatDuration(event.start, event.end) }}</span>
      </p>
      <p v-if="showTeachers || showGroups" class="people">
        <span v-if="showTeachers" class="teachers">{{ event.teachers.join(', ') }}</span>
        <span v-if="showTeachers && showGroups" aria-hidden="true"> · </span>
        <span v-if="showGroups" class="groups">{{ event.groups.join(', ') }}</span>
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
  border-inline-start: 4px solid var(--kind);
  border-radius: var(--radius);
  overflow: hidden;
}
/* Côte à côte, la colonne d'horaires mangerait la moitié de la carte :
   les heures repassent sur une ligne, au-dessus du titre. */
/* Le contenu reste en haut : une carte tient la hauteur de sa durée, l'espace
   libre d'un long cours se laisse en bas plutôt que de délier ses lignes. */
.card.compact { grid-template-columns: 1fr; gap: 0.3rem 0; padding: 0.7rem 0.75rem; align-content: start; }
.card.compact .hours { flex-direction: row; align-items: center; gap: 0.35rem; font-size: 0.88rem; }
.card.compact .dash { width: 0.5rem; height: 1px; margin: 0; }
.card.compact .subject { font-size: 0.95rem; }
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

.dept {
  padding: 0 0.35rem;
  border: 1px solid var(--line);
  border-radius: 999px;
  font-size: 0.66rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  color: var(--text-muted);
}

.people { margin: 0.25rem 0 0; font-size: 0.85rem; color: var(--text-muted); overflow-wrap: anywhere; }
.teachers { color: var(--text); font-weight: 500; }
.groups { opacity: 0.85; }
.live { margin: 0.35rem 0 0; font-size: 0.8rem; font-weight: 600; color: var(--kind); }
</style>
