<script setup>
import { computed, onMounted, watch } from 'vue';
import { useCrousMenu } from '../composables/useCrousMenu.js';
import { t } from '../i18n.js';

const props = defineProps({
  /** Jour affiché (`AAAA-MM-JJ`). */
  day: { type: String, required: true },
});

const { restaurant, loading, failed, load, menuFor } = useCrousMenu();

onMounted(() => load());
watch(() => props.day, () => load());

const menu = computed(() => menuFor(props.day));
const name = computed(() => restaurant.value?.name || t('crous.fallbackName'));
const hours = computed(() => restaurant.value?.hours?.[0] || t('crous.fallbackHours'));

/* Trois états seulement : fermé, menu publié, rien de publié. */
const state = computed(() => {
  if (!menu.value) return loading.value ? 'loading' : 'unknown';
  if (menu.value.closed || !menu.value.categories.length) return 'closed';
  return 'menu';
});
</script>

<template>
  <!-- Rien à dire si l'API est injoignable : l'emploi du temps reste prioritaire. -->
  <section v-if="!failed" class="crous" :class="{ closed: state === 'closed' }" :aria-label="t('crous.aria')">
    <header class="head">
      <span class="tag">{{ t('crous.tag') }}</span>
      <span class="name">{{ name }}</span>
      <span class="hours">{{ hours }}</span>
    </header>

    <p v-if="state === 'closed'" class="note">{{ t('crous.closed') }}</p>
    <p v-else-if="state === 'loading'" class="note">{{ t('crous.loading') }}</p>
    <p v-else-if="state === 'unknown'" class="note">{{ t('crous.unknown') }}</p>

    <dl v-else class="courses">
      <template v-for="cat in menu.categories" :key="cat.label">
        <dt>{{ cat.label }}</dt>
        <dd>
          <ul>
            <li v-for="dish in cat.dishes" :key="dish">{{ dish }}</li>
          </ul>
        </dd>
      </template>
    </dl>
  </section>
</template>

<style scoped>
.crous {
  flex: 1;
  overflow: hidden;
  background: var(--crous-soft);
  border: 1px solid color-mix(in srgb, var(--crous) 45%, transparent);
  border-inline-start: 4px solid var(--crous-strong);
  border-radius: var(--radius);
}

.head {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 0.3rem 0.5rem;
  padding: 0.45rem 0.6rem;
  background: var(--crous-strong);
}
.tag {
  font-size: 0.66rem;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #fff;
}
.name {
  font-size: 0.82rem;
  font-weight: 600;
  color: #fff;
}
.hours {
  margin-inline-start: auto;
  font-size: 0.72rem;
  color: color-mix(in srgb, #fff 78%, transparent);
  font-variant-numeric: tabular-nums;
}

.note {
  margin: 0;
  padding: 0.55rem 0.7rem;
  font-size: 0.82rem;
  color: var(--crous);
  font-weight: 600;
}

.courses {
  margin: 0;
  padding: 0.5rem 0.7rem 0.6rem;
  display: grid;
  /* Libellé de catégorie à gauche, plats à droite : lisible d'un coup d'œil. */
  grid-template-columns: minmax(4.5rem, auto) 1fr;
  gap: 0.25rem 0.7rem;
  font-size: 0.82rem;
}
.courses dt {
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--crous);
  padding-top: 0.1rem;
}
.courses dd { margin: 0; color: var(--text); }
.courses ul { list-style: none; margin: 0; padding: 0; }
.courses li + li { margin-top: 0.1rem; }

.crous.closed .courses { display: none; }

@media (max-width: 420px) {
  .courses { grid-template-columns: 1fr; gap: 0.1rem; }
  .courses dt { padding-top: 0.35rem; }
  .courses dt:first-of-type { padding-top: 0; }
}
</style>
