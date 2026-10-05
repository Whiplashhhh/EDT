import { computed, ref, watch } from 'vue';
import { api } from '../api.js';
import { mondayOf } from '../dates.js';
import { alignToSlots, gridDepartment } from '../slots.js';
import { errorMessage } from '../i18n.js';
import { readCachedSchedule, writeCachedSchedule } from './useStorage.js';

/**
 * Charge l'emploi du temps de la ressource sélectionnée — une classe, une salle
 * ou un enseignant. ADE publie une fenêtre d'environ douze semaines à partir
 * d'un lundi donné : on recharge seulement quand on sort de la fenêtre déjà
 * en mémoire.
 *
 * `cacheSlot` sépare le cache hors ligne de deux emplois du temps chargés en
 * même temps.
 */
export function useSchedule(department, kind, resourceId, focusedDay, { cacheSlot } = {}) {
  const published = ref([]);
  const loading = ref(false);
  /** Rien à montrer : l'emploi du temps n'a pas pu être chargé. */
  const error = ref(null);
  /** Chargement en cours, et en attendant, la copie enregistrée sur l'appareil. */
  const stale = ref(false);
  /**
   * Un emploi du temps s'affiche, mais pas à jour : `{ reason, fetchedAt }`, où
   * `reason` vaut `ade` (l'ULCO ne répond pas) ou `offline` (notre serveur non plus).
   */
  const outdated = ref(null);
  const fetchedAt = ref(null);
  const windowStart = ref(null);
  let controller = null;

  /* ADE publie des blocs d'une heure et demie : on leur rend l'horaire réel du
     département avant de les montrer. */
  const events = computed(() => alignToSlots(department.value, published.value));

  /* Sur quelle grille graduer la vue semaine : celle de la formation consultée,
     ou celle des cours affichés quand on regarde une salle ou un enseignant. */
  const grid = computed(() => gridDepartment(department.value, published.value));

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
    if (!department.value || !resourceId.value) {
      published.value = [];
      return;
    }
    const from = mondayOf(focusedDay.value);
    if (!force && windowStart.value === from) return;

    controller?.abort();
    controller = new AbortController();

    const cached = readCachedSchedule(department.value, kind.value, resourceId.value, from, cacheSlot);
    if (cached) {
      published.value = cached.events;
      fetchedAt.value = cached.fetchedAt;
      windowStart.value = from;
      stale.value = true;
    }

    loading.value = true;
    error.value = null;
    outdated.value = null;
    try {
      const data = await api.schedule(department.value, kind.value, resourceId.value, from, controller.signal);
      stale.value = false;
      // Le secours du serveur peut être plus ancien que la copie de l'appareil : on garde la plus récente.
      if (data.stale && cached && cached.fetchedAt >= data.fetchedAt) {
        outdated.value = { reason: 'ade', fetchedAt: cached.fetchedAt };
        return;
      }
      published.value = data.events;
      fetchedAt.value = data.fetchedAt;
      windowStart.value = from;
      if (data.stale) outdated.value = { reason: 'ade', fetchedAt: data.fetchedAt };
      writeCachedSchedule({ ...data, from }, cacheSlot);
    } catch (err) {
      if (err.name === 'AbortError') return;
      stale.value = false;
      if (cached) outdated.value = { reason: err.code === 'ade' ? 'ade' : 'offline', fetchedAt: cached.fetchedAt };
      else error.value = errorMessage(err, 'error.schedule');
    } finally {
      loading.value = false;
    }
  }

  watch([department, kind, resourceId], () => {
    windowStart.value = null;
    published.value = [];
    load();
  });
  watch(focusedDay, () => load());

  return { events, eventsByDay, grid, loading, error, stale, outdated, fetchedAt, load };
}
