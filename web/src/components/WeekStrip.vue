<script setup>
import { computed } from 'vue';
import { addDays, dayNumber, formatDayShort, mondayOf, today, weekNumber } from '../dates.js';

const props = defineProps({
  focused: { type: String, required: true },
  eventsByDay: { type: Map, required: true },
});
const emit = defineEmits(['select', 'shift']);

const monday = computed(() => mondayOf(props.focused));
// Samedi et dimanche restent visibles : l'ULCO y place parfois des rattrapages.
const days = computed(() => Array.from({ length: 7 }, (_, i) => addDays(monday.value, i)));
const label = computed(() => `Semaine ${weekNumber(monday.value)}`);
</script>

<template>
  <nav class="strip" aria-label="Semaine">
    <div class="head">
      <button class="nav" type="button" aria-label="Semaine précédente" @click="emit('shift', -7)">‹</button>
      <span class="week">{{ label }}</span>
      <button class="nav" type="button" aria-label="Semaine suivante" @click="emit('shift', 7)">›</button>
    </div>
    <ol class="days">
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
          <span class="dots" aria-hidden="true">
            <i v-for="n in Math.min(3, (eventsByDay.get(day) || []).length)" :key="n"></i>
          </span>
          <span class="sr-only">{{ (eventsByDay.get(day) || []).length }} cours</span>
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
  padding: 0.1rem 0 0.45rem;
}
.week { font-size: 0.85rem; font-weight: 600; color: var(--text-muted); letter-spacing: 0.01em; }
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

.dots { display: flex; gap: 2px; height: 4px; align-items: center; }
.dots i { width: 4px; height: 4px; border-radius: 999px; background: var(--text-muted); }
.day.active .dots i { background: var(--accent); }
</style>
