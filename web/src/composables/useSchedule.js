import { computed, ref, watch } from 'vue';
import { api } from '../api.js';
import { mondayOf } from '../dates.js';
import { readCachedSchedule, writeCachedSchedule } from './useStorage.js';

/**
 * Charge l'emploi du temps du groupe sélectionné.
 * ADE publie une fenêtre d'environ douze semaines à partir d'un lundi donné :
 * on recharge seulement quand on sort de la fenêtre déjà en mémoire.
 */
export function useSchedule(department, groupId, focusedDay) {
  const events = ref([]);
  const loading = ref(false);
  const error = ref(null);
  const stale = ref(false);
  const fetchedAt = ref(null);
  const windowStart = ref(null);
  let controller = null;

  const eventsByDay = computed(() => {
    const map = new Map();
    for (const event of events.value) {
      const day = event.start.slice(0, 10);
      if (!map.has(day)) map.set(day, []);
      map.get(day).push(event);
    }
    return map;
  });

  async function load(force = false) {
    if (!department.value || !groupId.value) {
      events.value = [];
      return;
    }
    const from = mondayOf(focusedDay.value);
    if (!force && windowStart.value === from) return;

    controller?.abort();
    controller = new AbortController();

    const cached = readCachedSchedule(department.value, groupId.value, from);
    if (cached) {
      events.value = cached.events;
      fetchedAt.value = cached.fetchedAt;
      windowStart.value = from;
      stale.value = true;
    }

    loading.value = true;
    error.value = null;
    try {
      const data = await api.schedule(department.value, groupId.value, from, controller.signal);
      events.value = data.events;
      fetchedAt.value = data.fetchedAt;
      windowStart.value = from;
      stale.value = false;
      writeCachedSchedule({ ...data, from });
    } catch (err) {
      if (err.name === 'AbortError') return;
      error.value = cached
        ? 'Données hors ligne : impossible de contacter le serveur.'
        : err.message || 'Impossible de charger l’emploi du temps.';
      stale.value = Boolean(cached);
    } finally {
      loading.value = false;
    }
  }

  watch([department, groupId], () => {
    windowStart.value = null;
    events.value = [];
    load();
  });
  watch(focusedDay, () => load());

  return { events, eventsByDay, loading, error, stale, fetchedAt, load };
}
