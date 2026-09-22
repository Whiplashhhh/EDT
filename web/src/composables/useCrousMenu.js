import { readonly, ref } from 'vue';
import { api } from '../api.js';

/**
 * Menu du restaurant universitaire de l'établissement.
 *
 * Le serveur n'expose qu'un seul restaurant : il n'y a donc rien à choisir.
 * L'état est partagé par tous les appelants — le menu couvre plusieurs jours,
 * un seul chargement suffit pour toute la session.
 */
const days = ref([]);
const restaurant = ref(null);
const loading = ref(false);
const failed = ref(false);
let fetchedAt = 0;
let pending = null;

/** Au-delà d'une demi-heure, on redemande : le Crous peut publier en cours de journée. */
const MAX_AGE_MS = 30 * 60_000;

async function load(force = false) {
  if (pending) return pending;
  if (!force && fetchedAt && Date.now() - fetchedAt < MAX_AGE_MS) return null;

  loading.value = true;
  pending = api.crousMenu()
    .then((data) => {
      days.value = data.days ?? [];
      restaurant.value = data.restaurant ?? null;
      fetchedAt = Date.now();
      failed.value = false;
    })
    .catch(() => {
      // Un menu absent ne doit jamais masquer l'emploi du temps : on se tait.
      failed.value = true;
    })
    .finally(() => {
      loading.value = false;
      pending = null;
    });
  return pending;
}

export function useCrousMenu() {
  return {
    days: readonly(days),
    restaurant: readonly(restaurant),
    loading: readonly(loading),
    failed: readonly(failed),
    load,
    /** Entrée du jour, ou `null` si le Crous n'a rien publié pour cette date. */
    menuFor: (day) => days.value.find((d) => d.day === day) ?? null,
  };
}
