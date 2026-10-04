<script setup>
import { computed } from 'vue';
import { addDays, dayNumber, formatDayShort, formatMonthSpan, mondayOf, today, weekNumber } from '../dates.js';
import { t } from '../i18n.js';

const props = defineProps({
  focused: { type: String, required: true },
  eventsByDay: { type: Map, required: true },
  /* En vue semaine, les en-têtes de colonnes nomment déjà les jours : la rangée ferait doublon. */
  showDays: { type: Boolean, default: true },
});
const emit = defineEmits(['select', 'shift']);

const monday = computed(() => mondayOf(props.focused));
// Samedi et dimanche restent visibles : l'ULCO y place parfois des rattrapages.
const days = computed(() => Array.from({ length: 7 }, (_, i) => addDays(monday.value, i)));
const label = computed(() => t('week.label', { n: weekNumber(monday.value) }));
const month = computed(() => formatMonthSpan(monday.value));
const countOf = (day) => (props.eventsByDay.get(day) || []).length;
</script>

<template>
  <nav class="strip" :aria-label="t('week.nav')">
    <div class="head">
      <button class="nav" type="button" :aria-label="t('week.previous')" @click="emit('shift', -7)">‹</button>
      <span class="title">
        <span class="month">{{ month }}</span>
        <span class="week">{{ label }}</span>
      </span>
      <button class="nav" type="button" :aria-label="t('week.next')" @click="emit('shift', 7)">›</button>
    </div>
    <ol v-if="showDays" class="days">
      <li v-for="day in days" :key="day">
        <button
          type="button"
          class="day"
          :class="{ active: day === focused, today: day === today() }"
          :aria-current="day === focused ? 'date' : undefined"
          @click="emit('select', day)"
        >
          <span class="name">{{ formatDayShort(day) }}</span>
          <span class="num">{{ dayNumber(day) }}</span>
          <!-- Le nombre de cours, pas des points : trois points ne disent pas si
               la journée en compte trois ou cinq. Un jour sans cours reste vide. -->
          <span class="count" aria-hidden="true">{{ countOf(day) || '' }}</span>
          <span class="sr-only">{{ t('day.courses', { n: countOf(day) }) }}</span>
        </button>
      </li>
    </ol>
  </nav>
</template>

<style scoped>
.strip { padding: 0 0.75rem 0.5rem; background: var(--bg); }

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.25rem 0 0.5rem;
}
.title { display: grid; justify-items: center; gap: 0.05rem; line-height: 1.2; }
.month { font-size: 1rem; font-weight: 700; letter-spacing: 0.01em; }
.week { font-size: 0.72rem; font-weight: 600; color: var(--text-muted); letter-spacing: 0.02em; }
.nav {
  width: 2rem; height: 2rem;
  display: grid; place-items: center;
  font-size: 1.35rem; line-height: 1;
  color: var(--text-muted);
  border-radius: 999px;
}
.nav:hover { background: var(--bg-elevated); color: var(--text); }

.days {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 0.3rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.day {
  width: 100%;
  display: grid;
  justify-items: center;
  gap: 0.15rem;
  padding: 0.45rem 0 0.4rem;
  border-radius: var(--radius-sm);
  border: 1px solid transparent;
  transition: background 0.15s ease, border-color 0.15s ease;
}
.day:hover { background: var(--bg-elevated); }
.name { font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); }
.num { font-size: 1.05rem; font-weight: 650; font-variant-numeric: tabular-nums; }

.day.today .num { color: var(--accent); }
.day.active { background: var(--accent-soft); border-color: color-mix(in srgb, var(--accent) 45%, transparent); }
.day.active .name { color: var(--text); }

.count {
  min-height: 0.8rem;
  font-size: 0.66rem;
  font-weight: 600;
  line-height: 0.8rem;
  font-variant-numeric: tabular-nums;
  color: var(--text-muted);
}
.day.active .count { color: var(--accent); }
</style>
