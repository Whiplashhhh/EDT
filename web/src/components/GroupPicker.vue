<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { api } from '../api.js';
import { errorMessage, t } from '../i18n.js';

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
/** Identifiants des nœuds dépliés. */
const expanded = ref(new Set());
const searchInput = ref(null);

/** Aplatit l'arbre ADE : chaque nœud garde son chemin lisible pour la recherche. */
function flatten(nodes, trail = []) {
  return nodes.flatMap((node) => {
    const path = [...trail, node.name];
    return [{ id: node.id, name: node.name, parents: trail, label: path.join(' › ') }, ...flatten(node.children, path)];
  });
}

const allGroups = computed(() => (catalog.value ? flatten(catalog.value.groups) : []));

const results = computed(() => {
  const q = query.value.trim().toLowerCase();
  return q ? allGroups.value.filter((g) => g.label.toLowerCase().includes(q)) : [];
});

/** Chemin d'identifiants menant à chaque nœud, pour déplier la branche du groupe courant. */
const ancestors = computed(() => {
  const map = new Map();
  const walk = (nodes, trail) => {
    for (const node of nodes) {
      map.set(node.id, trail);
      walk(node.children, [...trail, node.id]);
    }
  };
  if (catalog.value) walk(catalog.value.groups, []);
  return map;
});

/** L'arbre à plat, réduit aux branches dépliées : plus simple qu'un composant récursif. */
const visible = computed(() => {
  const out = [];
  const walk = (nodes, depth) => {
    for (const node of nodes) {
      const open = expanded.value.has(node.id);
      out.push({ id: node.id, name: node.name, depth, children: node.children.length, open });
      if (node.children.length && open) walk(node.children, depth + 1);
    }
  };
  if (catalog.value) walk(catalog.value.groups, 0);
  return out;
});

const isCurrent = (id) => id === props.groupId && selectedDept.value === props.department;

function toggle(id) {
  if (expanded.value.has(id)) expanded.value.delete(id);
  else expanded.value.add(id);
}

function pick(id, name) {
  emit('choose', { department: selectedDept.value, groupId: id, groupName: name });
}

async function loadCatalog(id) {
  if (!id) return;
  loading.value = true;
  error.value = null;
  try {
    catalog.value = await api.groups(id);
    // À l'ouverture : racines dépliées, et la branche du groupe déjà choisi.
    const open = new Set(catalog.value.groups.map((node) => node.id));
    for (const parent of ancestors.value.get(props.groupId) ?? []) open.add(parent);
    expanded.value = open;
  } catch (err) {
    error.value = errorMessage(err, 'error.groups');
    catalog.value = null;
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  searchInput.value?.focus();
  try {
    const data = await api.departments();
    departments.value = data.departments;
    if (!selectedDept.value && data.departments.length > 0) selectedDept.value = data.departments[0].id;
  } catch (err) {
    error.value = errorMessage(err, 'error.network');
  }
});

watch(selectedDept, (id) => loadCatalog(id), { immediate: true });
</script>

<template>
  <div class="picker" @keydown.esc.stop="emit('close')">
    <div class="fields">
      <select v-if="departments.length > 1" v-model="selectedDept" :aria-label="t('picker.department')">
        <option v-for="dept in departments" :key="dept.id" :value="dept.id">{{ dept.label }}</option>
      </select>
      <input
        ref="searchInput"
        v-model="query"
        type="search"
        inputmode="search"
        :placeholder="t('picker.search')"
        :aria-label="t('picker.search')"
        autocomplete="off"
      />
    </div>

    <p v-if="loading" class="state">{{ t('picker.loading') }}</p>
    <p v-else-if="error" class="state error">{{ error }}</p>

    <!-- Pendant une recherche, l'arbre laisse place à la liste des correspondances. -->
    <ul v-else-if="query.trim()" class="tree" role="listbox">
      <li v-for="group in results" :key="group.id">
        <button type="button" class="row lone" :class="{ current: isCurrent(group.id) }" @click="pick(group.id, group.name)">
          <span class="name">{{ group.name }}</span>
          <span v-if="group.parents.length" class="trail">{{ group.parents.join(' › ') }}</span>
        </button>
      </li>
      <li v-if="!results.length" class="state">{{ t('picker.empty') }}</li>
    </ul>

    <ul v-else class="tree" role="tree">
      <li v-for="node in visible" :key="node.id" :style="{ '--depth': node.depth }">
        <button
          v-if="node.children"
          type="button"
          class="twist"
          :aria-expanded="node.open"
          :aria-label="t(node.open ? 'picker.collapse' : 'picker.expand', { name: node.name })"
          @click="toggle(node.id)"
        >▸</button>
        <span v-else class="twist dot" aria-hidden="true">•</span>

        <button type="button" class="row" :class="{ current: isCurrent(node.id) }" @click="pick(node.id, node.name)">
          <span class="name">{{ node.name }}</span>
          <span v-if="isCurrent(node.id)" class="check" aria-hidden="true">✓</span>
        </button>
      </li>
    </ul>

    <p v-if="!groupId" class="hint">{{ t('picker.hint') }}</p>
  </div>
</template>

<style scoped>
.picker { display: flex; flex-direction: column; min-height: 0; padding: 0.5rem; }

.fields { display: flex; gap: 0.4rem; padding: 0.15rem 0.15rem 0.45rem; }
.fields select, .fields input {
  flex: 1;
  min-width: 0;
  padding: 0.5rem 0.6rem;
  font: inherit;
  font-size: 0.9rem;
  color: var(--text);
  background: var(--bg-sunken);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
}
.fields select { flex: 0 1 auto; }
.fields input:focus, .fields select:focus { outline: 2px solid var(--accent); outline-offset: 1px; }

.tree {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}
.tree > li { display: flex; align-items: center; gap: 0.1rem; padding-left: calc(var(--depth, 0) * 0.9rem); }

.twist {
  flex: none;
  width: 1.5rem;
  height: 1.9rem;
  display: grid;
  place-items: center;
  font-size: 0.7rem;
  color: var(--text-muted);
  border-radius: var(--radius-sm);
  /* La flèche pivote plutôt que de changer de glyphe : pas de saut de largeur. */
  transition: transform 0.12s ease;
}
.twist[aria-expanded='true'] { transform: rotate(90deg); }
.twist:not(.dot):hover { background: var(--bg-sunken); color: var(--text); }
.dot { font-size: 0.6rem; opacity: 0.55; cursor: default; }

.row {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  padding: 0.4rem 0.55rem;
  border-radius: var(--radius-sm);
  text-align: left;
  font-size: 0.92rem;
  color: var(--text);
}
.row.lone { margin-left: 1.6rem; flex-direction: column; align-items: flex-start; gap: 0.05rem; }
.row:hover { background: var(--bg-sunken); }
.row.current { background: var(--accent-soft); color: var(--accent); font-weight: 650; }
.name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.check { margin-left: auto; font-size: 0.8rem; }
.trail { font-size: 0.74rem; color: var(--text-muted); }

.state { padding: 0.8rem 0.6rem; margin: 0; color: var(--text-muted); font-size: 0.88rem; }
.error { color: var(--danger); }
.hint { margin: 0.35rem 0.6rem 0.2rem; font-size: 0.74rem; color: var(--text-muted); }
</style>
