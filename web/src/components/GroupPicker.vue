<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { api } from '../api.js';

const props = defineProps({
  department: { type: String, default: null },
  groupId: { type: Number, default: null },
});
const emit = defineEmits(['choose', 'close']);

const departments = ref([]);
const selectedDept = ref(props.department);
const catalog = ref(null);
const query = ref('');
const loading = ref(false);
const error = ref(null);

/** Aplatit l'arbre ADE : chaque nœud garde son chemin lisible pour la recherche. */
function flatten(nodes, trail = []) {
  return nodes.flatMap((node) => {
    const path = [...trail, node.name];
    return [{ id: node.id, name: node.name, depth: node.depth, parents: trail, label: path.join(' › ') }, ...flatten(node.children, path)];
  });
}

const allGroups = computed(() => (catalog.value ? flatten(catalog.value.groups) : []));

const results = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return allGroups.value;
  return allGroups.value.filter((g) => g.label.toLowerCase().includes(q));
});

async function loadCatalog(id) {
  if (!id) return;
  loading.value = true;
  error.value = null;
  try {
    catalog.value = await api.groups(id);
  } catch (err) {
    error.value = err.message || 'Impossible de charger la liste des groupes.';
    catalog.value = null;
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  try {
    const data = await api.departments();
    departments.value = data.departments;
    if (!selectedDept.value && data.departments.length > 0) selectedDept.value = data.departments[0].id;
  } catch (err) {
    error.value = err.message || 'Impossible de contacter le serveur.';
  }
});

watch(selectedDept, (id) => loadCatalog(id), { immediate: true });
</script>

<template>
  <div class="picker">
    <header class="head">
      <h2>Choisir sa classe</h2>
      <button v-if="groupId" class="close" type="button" aria-label="Fermer" @click="emit('close')">✕</button>
    </header>

    <p class="hint">Le choix est mémorisé sur cet appareil : la prochaine ouverture affichera directement cet emploi du temps.</p>

    <label v-if="departments.length > 1" class="field">
      <span>Formation</span>
      <select v-model="selectedDept">
        <option v-for="dept in departments" :key="dept.id" :value="dept.id">{{ dept.label }}</option>
      </select>
    </label>

    <label class="field">
      <span>Rechercher</span>
      <input v-model="query" type="search" inputmode="search" placeholder="BUT1-TD1, BUT2…" autocomplete="off" />
    </label>

    <p v-if="loading" class="state">Chargement des groupes…</p>
    <p v-else-if="error" class="state error">{{ error }}</p>

    <ul v-else class="groups">
      <li v-for="group in results" :key="group.id">
        <button
          type="button"
          class="group"
          :class="{ current: group.id === groupId && selectedDept === department }"
          :style="{ paddingLeft: `${0.9 + (group.depth - 1) * 0.85}rem` }"
          @click="emit('choose', { department: selectedDept, groupId: group.id, groupName: group.name })"
        >
          <span class="name">{{ group.name }}</span>
          <span v-if="query && group.parents.length" class="trail">{{ group.parents.join(' › ') }}</span>
        </button>
      </li>
      <li v-if="!results.length" class="state">Aucun groupe ne correspond.</li>
    </ul>
  </div>
</template>

<style scoped>
.picker { padding: 1rem 0.95rem calc(1.5rem + var(--safe-bottom)); }
.head { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
h2 { margin: 0; font-size: 1.15rem; }
.close { width: 2.2rem; height: 2.2rem; border-radius: 999px; color: var(--text-muted); font-size: 1rem; }
.close:hover { background: var(--bg-elevated); color: var(--text); }

.hint { margin: 0.4rem 0 1rem; font-size: 0.85rem; color: var(--text-muted); }

.field { display: block; margin-bottom: 0.8rem; }
.field > span { display: block; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); margin-bottom: 0.3rem; }
.field input, .field select {
  width: 100%;
  padding: 0.65rem 0.75rem;
  font: inherit;
  color: var(--text);
  background: var(--bg-elevated);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
}
.field input:focus, .field select:focus { outline: 2px solid var(--accent); outline-offset: 1px; }

.groups { list-style: none; margin: 0.4rem 0 0; padding: 0; }
.group {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.1rem;
  padding: 0.7rem 0.9rem;
  border-radius: var(--radius-sm);
  text-align: left;
}
.group:hover { background: var(--bg-elevated); }
.group.current { background: var(--accent-soft); }
.group.current .name { color: var(--accent); font-weight: 650; }
.name { font-size: 1rem; }
.trail { font-size: 0.76rem; color: var(--text-muted); }

.state { padding: 1rem 0.2rem; color: var(--text-muted); font-size: 0.9rem; }
.error { color: var(--danger); }
</style>
