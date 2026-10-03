import { computed, reactive, unref } from 'vue';
import { api } from '../api.js';

/**
 * Menu du restaurant universitaire le plus proche du campus de la formation.
 *
 * Le client ne choisit pas de restaurant : il donne sa formation, et le
 * serveur répond avec celui de sa ville. L'état est partagé par tous les
 * appelants, une entrée par formation — le menu couvre plusieurs jours, un
 * seul chargement suffit pour toute la session.
 */
// Une `Map` ordinaire : créer une entrée ne doit pas réveiller qui lit les autres.
const byDepartment = new Map();

/** Au-delà d'une demi-heure, on redemande : le Crous peut publier en cours de journée. */
const MAX_AGE_MS = 30 * 60_000;

function stateOf(department) {
  const key = department ?? '';
  if (!byDepartment.has(key)) {
    byDepartment.set(key, reactive({ days: [], restaurant: null, loading: false, failed: false, fetchedAt: 0, pending: null }));
  }
  return byDepartment.get(key);
}

async function load(department, force = false) {
  const state = stateOf(department);
  if (state.pending) return state.pending;
  if (!force && state.fetchedAt && Date.now() - state.fetchedAt < MAX_AGE_MS) return null;

  state.loading = true;
  state.pending = api.crousMenu(department)
    .then((data) => {
      state.days = data.days ?? [];
      state.restaurant = data.restaurant ?? null;
      state.fetchedAt = Date.now();
      state.failed = false;
    })
    .catch(() => {
      // Un menu absent ne doit jamais masquer l'emploi du temps : on se tait.
      state.failed = true;
    })
    .finally(() => {
      state.loading = false;
      state.pending = null;
    });
  return state.pending;
}

/** `department` : la formation affichée, en valeur ou en `ref`. */
export function useCrousMenu(department) {
  const state = computed(() => stateOf(unref(department)));
  return {
    days: computed(() => state.value.days),
    restaurant: computed(() => state.value.restaurant),
    loading: computed(() => state.value.loading),
    failed: computed(() => state.value.failed),
    load: (force = false) => load(unref(department), force),
    /** Entrée du jour, ou `null` si le Crous n'a rien publié pour cette date. */
    menuFor: (day) => state.value.days.find((d) => d.day === day) ?? null,
  };
}
