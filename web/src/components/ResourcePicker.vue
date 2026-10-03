<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { api } from '../api.js';
import { errorMessage, t } from '../i18n.js';
import { MAX_SUBJECTS, NO_TEACHER, formatSelection, parseSelection } from '../subjects.js';

const KINDS = ['groups', 'rooms', 'teachers', 'subjects'];
/**
 * Quand on choisit qui l'on est, les salles disparaissent : une salle n'a pas
 * d'emploi du temps « à soi », et personne ne reçoit de notification pour elle.
 * Les ressources restent : un vacataire absent d'ADE se reconnaît à celles
 * qu'il assure.
 */
const IDENTITY_KINDS = ['groups', 'teachers', 'subjects'];
/**
 * Département fictif du serveur : toutes les formations réunies. Une salle est
 * partagée par tout l'établissement, et un enseignant peut intervenir dans
 * plusieurs départements — on les cherche donc partout, et leur emploi du temps
 * les réunit tous. Une salle affichée formation par formation paraîtrait libre
 * alors qu'une autre l'occupe.
 */
const ALL_DEPARTMENTS = 'all';
/** Ville des formations que le serveur ne sait pas ranger (voir `server/config/ade.json`). */
const OTHER_CITY = 'autres';
/** Un vrai code de ressource — R1.01, P1.01, SAE5.B.00 — par opposition à un intitulé libre. */
const SUBJECT_CODE_RE = /^(?:[RP]\d|SAE\d)/;

const props = defineProps({
  department: { type: String, default: null },
  kind: { type: String, default: 'groups' },
  /** Un entier, ou une sélection de ressources (`12,34-0`). */
  resourceId: { type: [Number, String], default: null },
  /** Choix de l'identité : classe ou enseignant seulement, et un autre texte d'aide. */
  identityMode: { type: Boolean, default: false },
});
const emit = defineEmits(['choose', 'close']);

const kinds = computed(() => (props.identityMode ? IDENTITY_KINDS : KINDS));

/**
 * On choisit d'abord sa ville, puis on voit toutes les formations qu'on y
 * suit : l'ULCO compte quatre campus et plus de vingt composantes, que l'arbre
 * d'ADE range sans ordre géographique.
 */
const cities = ref([]);
const departments = ref([]);
/** La dernière ville choisie, retenue sur l'appareil pour la prochaine ouverture. */
const CITY_KEY = 'edt-ulco:city';
function storedCity() {
  try {
    return localStorage.getItem(CITY_KEY);
  } catch {
    return null;
  }
}
const selectedCity = ref(null);
watch(selectedCity, (city) => {
  try {
    if (city) localStorage.setItem(CITY_KEY, city);
  } catch {
    // Navigation privée : la ville sera simplement redemandée.
  }
});
// Ni une salle ni un enseignant n'appartiennent à une formation : `all` n'est
// pas un choix à mémoriser ici.
const selectedDept = ref(props.department === ALL_DEPARTMENTS ? null : props.department);
const cityOf = (deptId) => departments.value.find((d) => d.id === deptId)?.city ?? null;
const cityDepartments = computed(() => departments.value.filter((d) => d.city === selectedCity.value));
/** Les enseignants se cherchent dans toute l'ULCO : un nom ne dit pas le campus. */
const needsCity = computed(() => selectedKind.value !== 'teachers');
// En mode identité, une salle mémorisée ne peut pas servir de point de départ.
const selectedKind = ref(props.identityMode && !IDENTITY_KINDS.includes(props.kind) ? 'groups' : props.kind);
/**
 * Les arbres de toutes les formations de la ville, réunis : chaque formation
 * devient une racine, qu'on déplie pour trouver sa classe.
 */
const catalog = ref(null);
/** Formation de chaque nœud : c'est elle qui sert d'adresse à son emploi du temps. */
const nodeDept = ref(new Map());
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
/**
 * Pause du pointeur avant qu'une branche se déplie au survol : assez longue
 * pour qu'un simple passage de la souris vers une autre ligne n'ouvre rien.
 */
const HOVER_OPEN_MS = 650;
const searchInput = ref(null);

const isTree = computed(() => selectedKind.value === 'groups');
/**
 * Les ressources se cochent : on en réunit plusieurs, éventuellement de
 * plusieurs formations — un vacataire peut assurer R1.01 en informatique et
 * R3.04 en GEA.
 */
const isSubjects = computed(() => selectedKind.value === 'subjects');
/**
 * Les classes se chargent ville par ville. Le reste se charge pour toute
 * l'ULCO — une sélection de ressources peut mêler plusieurs formations — et se
 * filtre ensuite : les salles par ville, les ressources par formation, car
 * « R1.01 » n'est pas la même matière partout.
 */
const showsDepartment = computed(() => isSubjects.value && cityDepartments.value.length > 1);

/**
 * Ressources cochées, toutes formations confondues, chacune avec les
 * enseignants dont on écarte les séances.
 */
const picked = ref((props.kind === 'subjects' && parseSelection(props.resourceId)) || new Map());

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
  if (isSubjects.value) {
    return entries.value
      .filter((e) => e.department === selectedDept.value && `${e.name} ${e.label}`.toLowerCase().includes(q))
      // Les ressources codées d'abord : « FORUM » ou « Journée des anciens » ne sont que des séances isolées.
      .sort((a, b) => Number(!SUBJECT_CODE_RE.test(a.name)) - Number(!SUBJECT_CODE_RE.test(b.name)));
  }
  // Salles et enseignants : une liste plate, filtrée au fil de la frappe. Une
  // salle appartient à sa ville — « SALLE 25 » existe à Boulogne comme à Dunkerque.
  const inCity = selectedKind.value === 'rooms' ? entries.value.filter((e) => e.city === selectedCity.value) : entries.value;
  return q ? inCity.filter((e) => e.name.toLowerCase().includes(q)) : inCity;
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
      out.push({ id: node.id, name: node.name, depth, children: node.children.length, open, root: node.root });
      if (node.children.length && open) walk(node.children, depth + 1);
    }
  };
  if (catalog.value) walk(catalog.value.groups, 0);
  return out;
});

const isCurrent = (id) => {
  if (isSubjects.value) return picked.value.has(id);
  if (id !== props.resourceId || selectedKind.value !== props.kind) return false;
  return isTree.value ? nodeDept.value.get(id) === props.department : props.department === ALL_DEPARTMENTS;
};

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
    hoverTimer = setTimeout(() => openBranch(node.id, false), HOVER_OPEN_MS);
    return;
  }
  hoverTimer = setTimeout(() => openBranch(node.id, true), HOVER_OPEN_MS);
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
    department: isTree.value ? nodeDept.value.get(id) : ALL_DEPARTMENTS,
    kind: selectedKind.value,
    resourceId: id,
    resourceName: name,
  });
}

function togglePicked(id) {
  const next = new Map(picked.value);
  if (next.has(id)) next.delete(id);
  else if (next.size < MAX_SUBJECTS) next.set(id, new Set());
  picked.value = next;
}

/*
 * Une ressource partagée entre plusieurs enseignants — ou dont une partie des
 * séances n'en indique aucun — se filtre : chacun ne garde que les siennes.
 */
const isShared = (item) => isCurrent(item.id) && item.teachers?.length > 1;
const isKept = (item, teacherId) => !picked.value.get(item.id)?.has(teacherId);

function toggleTeacher(item, teacherId) {
  const without = new Set(picked.value.get(item.id));
  if (without.has(teacherId)) without.delete(teacherId);
  // Écarter tout le monde viderait la ressource : mieux vaut la décocher.
  else if (item.teachers.filter((t) => !without.has(t.id)).length > 1) without.add(teacherId);
  picked.value = new Map(picked.value).set(item.id, without);
}

/** Les ressources cochées encore connues : la liste suit la fenêtre de douze semaines. */
const pickedEntries = computed(() => entries.value.filter((e) => picked.value.has(e.id)));

/* Une sélection peut s'étendre sur plusieurs formations, qu'on ne voit qu'une à
   la fois : chaque formation dit combien de ses ressources sont cochées. */
const pickedPerDept = computed(() => {
  const counts = new Map();
  if (!isSubjects.value) return counts;
  for (const e of pickedEntries.value) counts.set(e.department, (counts.get(e.department) ?? 0) + 1);
  return counts;
});

/** Une ressource seule se nomme en entier ; plusieurs, par leurs seuls codes. */
function selectionName(list) {
  if (list.length === 1) return [list[0].name, list[0].label].filter(Boolean).join(' ');
  return list.map((e) => e.name).join(', ');
}

function showPicked() {
  const list = pickedEntries.value;
  if (!list.length) return;
  // Un enseignant parti de la ressource n'a plus à être écarté.
  const selection = new Map(
    list.map((e) => [e.id, new Set([...picked.value.get(e.id)].filter((id) => e.teachers?.some((t) => t.id === id)))]),
  );
  emit('choose', {
    department: ALL_DEPARTMENTS,
    kind: 'subjects',
    resourceId: formatSelection(selection),
    resourceName: selectionName(list),
  });
}

/** Le serveur nomme les villes en français ; la case « autres » se traduit. */
const cityLabel = (city) => (city.id === OTHER_CITY ? t('picker.otherCity') : city.label);

function setCity(city) {
  selectedCity.value = city;
  query.value = '';
  // Une formation d'une autre ville n'a plus rien à montrer.
  if (cityOf(selectedDept.value) !== city) selectedDept.value = cityDepartments.value[0]?.id ?? null;
  resetHover();
  searchInput.value?.focus();
}

function setKind(kind) {
  if (kind === selectedKind.value) return;
  selectedKind.value = kind;
  query.value = '';
  resetHover();
  searchInput.value?.focus();
}

/** Les arbres des formations de la ville, sous une racine chacune. */
async function loadCity(city) {
  const depts = departments.value.filter((d) => d.city === city);
  const results = await Promise.allSettled(depts.map((d) => api.groups(d.id)));
  const owner = new Map();
  const roots = [];
  results.forEach((result, i) => {
    if (result.status !== 'fulfilled') return;
    const dept = depts[i];
    const mark = (nodes) => {
      for (const node of nodes) {
        owner.set(node.id, dept.id);
        mark(node.children);
      }
    };
    mark(result.value.groups);
    // La racine n'est pas une classe : ADE refuse souvent de publier une
    // composante entière d'un bloc, et personne n'y suit tous les cours.
    roots.push({ id: `dept:${dept.id}`, name: dept.label, root: true, children: result.value.groups });
  });
  if (!roots.length && results.length) throw results[0].reason;
  return { roots, owner };
}

async function loadResources() {
  const kind = selectedKind.value;
  const city = selectedCity.value;
  if (kind === 'groups' && !city) return;
  loading.value = true;
  error.value = null;
  try {
    if (kind === 'groups') {
      const { roots, owner } = await loadCity(city);
      if (selectedCity.value !== city) return;
      nodeDept.value = owner;
      catalog.value = { groups: roots };
      // À l'ouverture : la branche de la classe déjà choisie, et elle seule.
      const open = new Set(ancestors.value.get(props.resourceId) ?? []);
      expanded.value = open;
      resetHover();
    } else {
      entries.value = (await api.directory(ALL_DEPARTMENTS, kind)).entries;
      // On rouvre sur la formation de la sélection en cours, pas sur la première venue.
      const first = entries.value.find((e) => picked.value.has(e.id));
      if (kind === 'subjects' && first?.department) {
        selectedDept.value = first.department;
        selectedCity.value = cityOf(first.department) ?? selectedCity.value;
      }
      if (kind === 'rooms' && props.kind === 'rooms') {
        const current = entries.value.find((e) => e.id === props.resourceId);
        if (current?.city) selectedCity.value = current.city;
      }
    }
  } catch (err) {
    error.value = errorMessage(err, `error.${kind}`);
    if (kind === 'groups') catalog.value = null;
    else entries.value = [];
  } finally {
    // Une réponse arrivée après un changement d'onglet ne doit plus rien afficher.
    if (selectedKind.value === kind && (kind !== 'groups' || selectedCity.value === city)) loading.value = false;
  }
}

onMounted(async () => {
  searchInput.value?.focus();
  try {
    const data = await api.departments();
    cities.value = data.cities;
    departments.value = data.departments;
    // La ville de ce qu'on regarde déjà, sinon celle de la dernière fois.
    const known = (id) => (data.cities.some((c) => c.id === id) ? id : null);
    selectedCity.value = known(cityOf(props.department)) ?? known(storedCity());
    if (!selectedDept.value || cityOf(selectedDept.value) !== selectedCity.value) {
      selectedDept.value = cityDepartments.value[0]?.id ?? null;
    }
  } catch (err) {
    error.value = errorMessage(err, 'error.network');
  }
});

// Les classes attendent la ville ; le reste se charge une fois pour toute l'ULCO.
watch([selectedKind, () => (isTree.value ? selectedCity.value : null)], loadResources, { immediate: true });
</script>

<template>
  <div class="picker" @keydown.esc.stop="emit('close')">
    <div class="tabs" role="tablist" :aria-label="t('picker.mode')">
      <button
        v-for="option in kinds"
        :key="option"
        type="button"
        role="tab"
        :class="{ on: selectedKind === option }"
        :aria-selected="selectedKind === option"
        @click="setKind(option)"
      >{{ t(`picker.kind.${option}`) }}</button>
    </div>

    <div class="fields">
      <select
        v-if="needsCity && selectedCity"
        :value="selectedCity"
        :aria-label="t('picker.city')"
        @change="setCity($event.target.value)"
      >
        <option v-for="city in cities" :key="city.id" :value="city.id">{{ cityLabel(city) }}</option>
      </select>
      <select
        v-if="showsDepartment"
        v-model="selectedDept"
        :aria-label="t('picker.department')"
      >
        <option v-for="dept in cityDepartments" :key="dept.id" :value="dept.id">
          {{ pickedPerDept.get(dept.id) ? `${dept.label} (${pickedPerDept.get(dept.id)})` : dept.label }}
        </option>
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

    <!-- Première étape : la ville. Tant qu'elle manque, il n'y a rien à lister. -->
    <div v-if="needsCity && !selectedCity && cities.length" class="cities">
      <p class="state">{{ t('picker.chooseCity') }}</p>
      <button v-for="city in cities" :key="city.id" type="button" class="city" @click="setCity(city.id)">
        <span class="name">{{ cityLabel(city) }}</span>
        <span class="trail">{{ departments.filter((d) => d.city === city.id).map((d) => d.label).join(' · ') }}</span>
      </button>
    </div>

    <p v-else-if="loading" class="state">{{ t('picker.loading') }}</p>
    <p v-else-if="error" class="state error">{{ error }}</p>

    <!-- Ressources : une liste à cocher. -->
    <ul v-else-if="isSubjects" class="tree" role="listbox" aria-multiselectable="true">
      <template v-for="item in results" :key="item.id">
      <li>
        <button
          type="button"
          role="option"
          class="row lone check-row"
          :class="{ current: isCurrent(item.id) }"
          :aria-selected="isCurrent(item.id)"
          :disabled="!isCurrent(item.id) && picked.size >= MAX_SUBJECTS"
          @click="togglePicked(item.id)"
        >
          <span class="box" aria-hidden="true">{{ isCurrent(item.id) ? '✓' : '' }}</span>
          <span class="name">
            <b>{{ item.name }}</b><span v-if="item.label" class="label">{{ item.label }}</span>
          </span>
          <span class="trail">{{ t('picker.courses', { n: item.courses }) }}</span>
        </button>
      </li>
      <li v-if="isShared(item)" class="teachers" role="group" :aria-label="t('picker.severalTeachers')">
        <p class="teachers-note">{{ t('picker.severalTeachers') }}</p>
        <button
          v-for="teacher in item.teachers"
          :key="teacher.id"
          type="button"
          role="checkbox"
          class="teacher"
          :class="{ on: isKept(item, teacher.id) }"
          :aria-checked="isKept(item, teacher.id)"
          @click="toggleTeacher(item, teacher.id)"
        >
          <span class="box" aria-hidden="true">{{ isKept(item, teacher.id) ? '✓' : '' }}</span>
          <span class="name">{{ teacher.id === NO_TEACHER ? t('picker.noTeacher') : teacher.name }}</span>
          <span class="trail">{{ t('picker.courses', { n: teacher.courses }) }}</span>
        </button>
      </li>
      </template>
      <li v-if="!results.length" class="state">{{ t('picker.empty') }}</li>
    </ul>

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

        <button
          type="button"
          class="row"
          :class="{ current: isCurrent(node.id), root: node.root }"
          @click="node.root ? toggle(node.id) : pick(node.id, node.name)"
        >
          <span class="name">{{ node.name }}</span>
          <span v-if="isCurrent(node.id)" class="check" aria-hidden="true">✓</span>
        </button>
      </li>
    </ul>

    <div v-if="isSubjects && !loading && !error" class="selection">
      <button v-if="picked.size" type="button" class="clear" @click="picked = new Map()">{{ t('picker.clearSelection') }}</button>
      <button type="button" class="show" :disabled="!pickedEntries.length" @click="showPicked">
        {{ t('picker.showSelection', { n: pickedEntries.length }) }}
      </button>
    </div>

    <p v-if="isSubjects" class="hint">{{ t('picker.subjectsHint') }}</p>
    <p v-else-if="identityMode || !resourceId" class="hint">
      {{ t(identityMode ? 'picker.identityHint' : 'picker.hint') }}
    </p>
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
  flex: 1 1 auto;
  padding: 0.35rem 0.4rem;
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
/*
  iOS Safari zoome automatiquement sur un champ dont la police fait moins de
  16px, et ne dézoome jamais ensuite. Sur écran tactile on garde donc 16px.
*/
@media (pointer: coarse) {
  .fields select, .fields input { font-size: 16px; }
}
.fields input:focus, .fields select:focus { outline: 2px solid var(--accent); outline-offset: 1px; }

.tree {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}
.tree > li { display: flex; align-items: center; gap: 0.3rem; padding-inline-start: calc(var(--depth, 0) * 0.9rem); }

/*
 * Le chevron est le seul moyen de déplier : cliquer sur le nom ouvre l'emploi
 * du temps du groupe entier. Il se lit donc comme un bouton à part entière
 * (cadre, fond, contraste) pour qu'on ne le confonde pas avec une décoration.
 */
.twist {
  flex: none;
  width: 1.75rem;
  height: 1.75rem;
  display: grid;
  place-items: center;
  font-size: 0.95rem;
  line-height: 1;
  color: var(--text);
  background: var(--bg-sunken);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  /* La flèche pivote plutôt que de changer de glyphe : pas de saut de largeur. */
  transition: transform 0.12s ease, background 0.12s ease, color 0.12s ease;
}
.twist[aria-expanded='true'] { transform: rotate(90deg); }
.twist:not(.dot):hover { background: var(--accent-soft); border-color: var(--accent); color: var(--accent); }
.twist:not(.dot):focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.dot {
  width: 1.75rem;
  font-size: 0.6rem;
  color: var(--text-muted);
  background: none;
  border: 0;
  opacity: 0.55;
  cursor: default;
}

.row {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  padding: 0.4rem 0.55rem;
  border-radius: var(--radius-sm);
  text-align: start;
  font-size: 0.92rem;
  color: var(--text);
}
.row.lone { margin-inline-start: 2.05rem; flex-direction: column; align-items: flex-start; gap: 0.05rem; }
.row:hover { background: var(--bg-sunken); }
.row.current { background: var(--accent-soft); color: var(--accent); font-weight: 650; }
.name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.check { margin-inline-start: auto; font-size: 0.8rem; }
.trail { font-size: 0.74rem; color: var(--text-muted); }

/*
 * Ressource à cocher : la case à gauche, le nom et le volume de cours à
 * droite. Le code est en gras, c'est par lui qu'on la reconnaît.
 */
.row.check-row { flex-direction: row; align-items: center; gap: 0.55rem; margin-inline-start: 0; }
.check-row .name { flex: 1; min-width: 0; }
.check-row .label { margin-inline-start: 0.35em; }
.check-row .trail { flex: none; }
.check-row:disabled { opacity: 0.45; cursor: not-allowed; }
.box {
  flex: none;
  width: 1.15rem;
  height: 1.15rem;
  display: grid;
  place-items: center;
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--bg);
  border: 1.5px solid var(--line);
  border-radius: 0.3rem;
}
.check-row.current .box,
.teacher.on .box { background: var(--accent); border-color: var(--accent); }

/* Le filtre par enseignant se range sous sa ressource, en retrait. */
.tree > li.teachers {
  flex-direction: column;
  align-items: stretch;
  gap: 0.1rem;
  margin: 0 0 0.35rem 2.2rem;
  padding: 0.4rem 0.45rem;
  background: var(--bg-sunken);
  border-radius: var(--radius-sm);
}
.teachers-note { margin: 0 0 0.2rem; font-size: 0.74rem; line-height: 1.35; color: var(--text-muted); }
.teacher {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.3rem 0.25rem;
  font-size: 0.85rem;
  text-align: start;
  color: var(--text-muted);
  border-radius: var(--radius-sm);
}
.teacher.on { color: var(--text); }
.teacher:hover { background: var(--bg-elevated); }
.teacher .name { flex: 1; min-width: 0; }
.teacher .box { width: 1rem; height: 1rem; font-size: 0.65rem; }

.selection {
  display: flex;
  justify-content: flex-end;
  gap: 0.4rem;
  padding: 0.5rem 0.15rem 0;
  border-top: 1px solid var(--line);
}
.selection button {
  padding: 0.45rem 0.8rem;
  font-size: 0.85rem;
  font-weight: 600;
  border-radius: 999px;
}
.selection .clear { color: var(--text-muted); }
.selection .clear:hover { color: var(--text); }
.selection .show { color: var(--bg); background: var(--accent); }
.selection .show:disabled { opacity: 0.45; cursor: not-allowed; }

/* Choix de la ville : une carte par campus, avec les formations qu'on y trouve. */
.cities { display: flex; flex-direction: column; gap: 0.35rem; overflow-y: auto; padding: 0 0.15rem; }
.city {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.15rem;
  padding: 0.65rem 0.75rem;
  text-align: start;
  color: var(--text);
  background: var(--bg-sunken);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
}
.city .name { font-weight: 650; font-size: 0.98rem; }
.city .trail { white-space: normal; line-height: 1.35; }
.city:hover { border-color: var(--accent); }
.city:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }

/* Une formation n'est pas une classe : elle se déplie, elle ne se choisit pas. */
.row.root { font-weight: 650; }

.state { padding: 0.8rem 0.6rem; margin: 0; color: var(--text-muted); font-size: 0.88rem; }
.error { color: var(--danger); }
.hint { margin: 0.35rem 0.6rem 0.2rem; font-size: 0.74rem; color: var(--text-muted); }
</style>
