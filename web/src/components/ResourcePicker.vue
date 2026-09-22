<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { api } from '../api.js';
import { errorMessage, t } from '../i18n.js';

const KINDS = ['groups', 'rooms', 'teachers'];

const props = defineProps({
  department: { type: String, default: null },
  kind: { type: String, default: 'groups' },
  resourceId: { type: Number, default: null },
});
const emit = defineEmits(['choose', 'close']);

const departments = ref([]);
const selectedDept = ref(props.department);
const selectedKind = ref(props.kind);
const catalog = ref(null);
const entries = ref([]);
const query = ref('');
const loading = ref(false);
const error = ref(null);
/** Identifiants des nœuds dépliés (arbre des classes uniquement). */
const expanded = ref(new Set());
/** Branche dépliée temporairement par le survol de la souris. */
const hovered = ref(new Set());
/** Nœuds repliés à la main pendant le survol : on ne les rouvre pas tout seuls. */
const hoverBlocked = ref(new Set());
let hoverTimer = null;
const searchInput = ref(null);

const isTree = computed(() => selectedKind.value === 'groups');

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
  if (isTree.value) return q ? allGroups.value.filter((g) => g.label.toLowerCase().includes(q)) : [];
  // Salles et enseignants : une liste plate, filtrée au fil de la frappe.
  return q ? entries.value.filter((e) => e.name.toLowerCase().includes(q)) : entries.value;
});

/** Chemin d'identifiants menant à chaque nœud, pour déplier la branche courante. */
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
      const open = isOpen(node.id);
      out.push({ id: node.id, name: node.name, depth, children: node.children.length, open });
      if (node.children.length && open) walk(node.children, depth + 1);
    }
  };
  if (catalog.value) walk(catalog.value.groups, 0);
  return out;
});

const isCurrent = (id) =>
  id === props.resourceId && selectedDept.value === props.department && selectedKind.value === props.kind;

const isOpen = (id) => expanded.value.has(id) || hovered.value.has(id);

function toggle(id) {
  if (isOpen(id)) {
    expanded.value.delete(id);
    hovered.value.delete(id);
    // Repli explicite : le survol ne doit pas le contredire dans la foulée.
    hoverBlocked.value = new Set(hoverBlocked.value).add(id);
    hovered.value = new Set(hovered.value);
  } else {
    expanded.value.add(id);
    hoverBlocked.value.delete(id);
  }
  expanded.value = new Set(expanded.value);
}

/** Survol : déplie la branche pointée après une courte pause, sans gêner le clic. */
function hoverNode(node, event) {
  if (event.pointerType === 'touch') return;
  clearTimeout(hoverTimer);
  if (!node.children) {
    // Sur une feuille, on garde seulement la branche qui y mène.
    hoverTimer = setTimeout(() => openBranch(node.id, false), 140);
    return;
  }
  hoverTimer = setTimeout(() => openBranch(node.id, true), 140);
}

function openBranch(id, self) {
  const next = new Set(ancestors.value.get(id) ?? []);
  if (self && !hoverBlocked.value.has(id)) next.add(id);
  for (const parent of next) hoverBlocked.value.delete(parent);
  hovered.value = next;
}

function leaveTree() {
  clearTimeout(hoverTimer);
  hoverTimer = setTimeout(() => {
    hovered.value = new Set();
    hoverBlocked.value = new Set();
  }, 220);
}

function resetHover() {
  clearTimeout(hoverTimer);
  hovered.value = new Set();
  hoverBlocked.value = new Set();
}

function pick(id, name) {
  emit('choose', {
    department: selectedDept.value,
    kind: selectedKind.value,
    resourceId: id,
    resourceName: name,
  });
}

function setKind(kind) {
  if (kind === selectedKind.value) return;
  selectedKind.value = kind;
  query.value = '';
  resetHover();
  searchInput.value?.focus();
}

async function loadResources() {
  const dept = selectedDept.value;
  const kind = selectedKind.value;
  if (!dept) return;
  loading.value = true;
  error.value = null;
  try {
    if (kind === 'groups') {
      catalog.value = await api.groups(dept);
      // À l'ouverture : racines dépliées, et la branche de la classe déjà choisie.
      const open = new Set(catalog.value.groups.map((node) => node.id));
      for (const parent of ancestors.value.get(props.resourceId) ?? []) open.add(parent);
      expanded.value = open;
      resetHover();
    } else {
      entries.value = (await api.directory(dept, kind)).entries;
    }
  } catch (err) {
    error.value = errorMessage(err, `error.${kind}`);
    if (kind === 'groups') catalog.value = null;
    else entries.value = [];
  } finally {
    // Une réponse arrivée après un changement d'onglet ne doit plus rien afficher.
    if (selectedKind.value === kind && selectedDept.value === dept) loading.value = false;
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

watch([selectedDept, selectedKind], loadResources, { immediate: true });
</script>

<template>
  <div class="picker" @keydown.esc.stop="emit('close')">
    <div class="tabs" role="tablist" :aria-label="t('picker.mode')">
      <button
        v-for="option in KINDS"
        :key="option"
        type="button"
        role="tab"
        :class="{ on: selectedKind === option }"
        :aria-selected="selectedKind === option"
        @click="setKind(option)"
      >{{ t(`picker.kind.${option}`) }}</button>
    </div>

    <div class="fields">
      <select v-if="departments.length > 1" v-model="selectedDept" :aria-label="t('picker.department')">
        <option v-for="dept in departments" :key="dept.id" :value="dept.id">{{ dept.label }}</option>
      </select>
      <input
        ref="searchInput"
        v-model="query"
        type="search"
        inputmode="search"
        :placeholder="t(`picker.search.${selectedKind}`)"
        :aria-label="t(`picker.search.${selectedKind}`)"
        autocomplete="off"
      />
    </div>

    <p v-if="loading" class="state">{{ t('picker.loading') }}</p>
    <p v-else-if="error" class="state error">{{ error }}</p>

    <!-- Salles et enseignants, ou recherche dans l'arbre : une liste plate. -->
    <ul v-else-if="!isTree || query.trim()" class="tree" role="listbox">
      <li v-for="item in results" :key="item.id">
        <button type="button" class="row lone" :class="{ current: isCurrent(item.id) }" @click="pick(item.id, item.name)">
          <span class="name">{{ item.name }}</span>
          <span v-if="item.parents?.length" class="trail">{{ item.parents.join(' › ') }}</span>
          <span v-else-if="item.courses" class="trail">{{ t('picker.courses', { n: item.courses }) }}</span>
        </button>
      </li>
      <li v-if="!results.length" class="state">{{ t('picker.empty') }}</li>
    </ul>

    <ul v-else class="tree" role="tree" @pointerleave="leaveTree">
      <li
        v-for="node in visible"
        :key="node.id"
        :style="{ '--depth': node.depth }"
        @pointerenter="hoverNode(node, $event)"
      >
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

    <p v-if="!resourceId" class="hint">{{ t('picker.hint') }}</p>
  </div>
</template>

<style scoped>
.picker { display: flex; flex-direction: column; min-height: 0; padding: 0.5rem; }

.tabs {
  display: flex;
  gap: 2px;
  padding: 2px;
  margin: 0.15rem 0.15rem 0.45rem;
  background: var(--bg-sunken);
  border-radius: 999px;
}
.tabs button {
  flex: 1;
  padding: 0.35rem 0.5rem;
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--text-muted);
  border-radius: 999px;
  white-space: nowrap;
}
.tabs button:hover { color: var(--text); }
.tabs button.on { color: var(--accent); background: var(--bg-elevated); box-shadow: 0 1px 3px rgb(0 0 0 / 0.18); }

.fields { display: flex; gap: 0.4rem; padding: 0 0.15rem 0.45rem; }
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
