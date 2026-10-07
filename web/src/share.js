/**
 * Liens de partage. L'adresse dit ce qu'on regarde : `?edt=info/groups/1234`
 * ouvre une classe, `?edt=all/teachers/5678` un enseignant, `?edt=info` toute
 * une formation — pour y trouver sa classe, pas pour en afficher l'emploi du
 * temps, illisible d'un bloc.
 *
 * Le lien ne porte que des identifiants : le nom se retrouve auprès du serveur,
 * qui sert aussi à vérifier que la ressource existe encore.
 */
import { api } from './api.js';
import { mondayOf } from './dates.js';
import { formatSelection, parseSelection } from './subjects.js';

export const SHARE_PARAM = 'edt';
/**
 * Une semaine ou une journée envoyée à quelqu'un qui n'a pas forcément
 * d'emploi du temps à l'ULCO — un parent, un ami : `?edt=…&semaine=2026-10-05`
 * ou `&jour=2026-10-07`. La page s'ouvre alors en lecture seule, sur cette
 * période et rien d'autre (voir `SharedView.vue`).
 */
const PERIOD_PARAMS = { week: 'semaine', day: 'jour' };
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const KINDS = ['groups', 'rooms', 'teachers', 'subjects'];
const ALL_DEPARTMENTS = 'all';
const DEPARTMENT_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const ID_RE = /^\d{1,12}$/;

/** Lit le lien de l'adresse : `{ department }`, `{ department, kind, resourceId }`, ou `null`. */
export function readShareLink(search) {
  const raw = new URLSearchParams(search).get(SHARE_PARAM);
  if (!raw) return null;
  const [department, kind, id, ...rest] = raw.split('/');
  if (rest.length || !DEPARTMENT_RE.test(department ?? '')) return null;
  if (kind === undefined) return department === ALL_DEPARTMENTS ? null : { department };
  if (!KINDS.includes(kind)) return null;
  // Une classe appartient à sa formation ; le reste se consulte toutes formations réunies.
  if ((kind === 'groups') === (department === ALL_DEPARTMENTS)) return null;
  if (kind === 'subjects') {
    const picks = parseSelection(id);
    return picks ? { department, kind, resourceId: formatSelection(picks) } : null;
  }
  return ID_RE.test(id ?? '') ? { department, kind, resourceId: Number(id) } : null;
}

/** Valeur du paramètre pour une ressource, ou pour une formation seule. Virgules et barres restent lisibles. */
function shareValue({ department, kind, resourceId }) {
  const parts = kind ? [department, kind, resourceId] : [department];
  return parts.map((part) => encodeURIComponent(String(part)).replace(/%2C/g, ',')).join('/');
}

/** Partie de l'adresse après le nom de domaine : `/?edt=…`. */
export function sharePath(target) {
  return `${location.pathname}?${SHARE_PARAM}=${shareValue(target)}`;
}

/**
 * Adresse complète à partager. Avec `period` (`week` ou `day`) et `day`, c'est
 * la page en lecture seule de cette semaine — dont `day` peut être n'importe
 * quel jour — ou de cette journée.
 */
export function shareUrl(target, { period, day } = {}) {
  const base = `${location.origin}${sharePath(target)}`;
  if (!period) return base;
  return `${base}&${PERIOD_PARAMS[period]}=${period === 'week' ? mondayOf(day) : day}`;
}

/**
 * Lit une page en lecture seule : `{ link, period, day }`, où `day` est le
 * lundi de la semaine ou le jour partagé. `null` si l'adresse n'en est pas une :
 * il faut une ressource précise et une date valide.
 */
export function readSharedPage(search) {
  const params = new URLSearchParams(search);
  const period = Object.keys(PERIOD_PARAMS).find((key) => params.has(PERIOD_PARAMS[key]));
  if (!period) return null;
  const link = readShareLink(search);
  const raw = params.get(PERIOD_PARAMS[period]);
  if (!link?.kind || !DAY_RE.test(raw) || Number.isNaN(Date.parse(`${raw}T12:00:00Z`))) return null;
  return { link, period, day: period === 'week' ? mondayOf(raw) : raw };
}

/** Une ressource seule se nomme en entier ; plusieurs, par leurs seuls codes. */
export function selectionName(list) {
  if (list.length === 1) return [list[0].name, list[0].label].filter(Boolean).join(' ');
  return list.map((e) => e.name).join(', ');
}

/** Cherche un nœud et sa profondeur : 1 pour une promo, 2 pour un TD, 3 pour un TP. */
function findNode(nodes, id, depth = 1) {
  for (const node of nodes) {
    if (node.id === id) return { node, depth };
    const found = findNode(node.children, id, depth + 1);
    if (found) return found;
  }
  return null;
}

function subtreeIds(node, out = new Set()) {
  out.add(node.id);
  for (const child of node.children) subtreeIds(child, out);
  return out;
}

/**
 * Complète un lien avec ce qu'il faut pour l'afficher : le nom de la
 * ressource, celui de la formation, et pour une classe sa profondeur et les
 * groupes qu'elle contient. `null` si le lien ne mène plus à rien.
 */
export async function resolveShareLink(link) {
  if (!link.kind || link.kind === 'groups') {
    const { departments } = await api.departments();
    const dept = departments.find((d) => d.id === link.department);
    if (!dept) return null;
    const base = { department: dept.id, departmentLabel: dept.label };
    if (!link.kind) return base;
    const { groups } = await api.groups(dept.id);
    const found = findNode(groups, link.resourceId);
    // Une classe disparue d'ADE : sa formation reste un bon point de départ.
    if (!found) return base;
    return { ...base, kind: link.kind, resourceId: link.resourceId, resourceName: found.node.name, depth: found.depth, subtree: subtreeIds(found.node) };
  }
  const { entries } = await api.directory(ALL_DEPARTMENTS, link.kind);
  if (link.kind === 'subjects') {
    const ids = [...parseSelection(link.resourceId).keys()];
    const list = entries.filter((e) => ids.includes(e.id));
    return list.length ? { ...link, resourceName: selectionName(list) } : null;
  }
  const entry = entries.find((e) => e.id === link.resourceId);
  return entry ? { ...link, resourceName: entry.name } : null;
}
