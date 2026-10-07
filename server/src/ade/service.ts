import { AdeClient, AdeError, parisMidnight, reach, type AdeResource } from './gwt.ts';
import { parseAdeIcs, type CourseEvent } from './ics.ts';
import { NO_TEACHER, formatSelection, subjectOf, type SubjectPick } from './subjects.ts';
import { nameLike, teacherAliases } from './teachers.ts';
import { TtlCache, type CacheOptions, type Lookup } from '../cache.ts';
import type { AppConfig } from '../config.ts';
import { mondayOf } from '../dates.ts';

/**
 * Les façons de consulter un emploi du temps, telles qu'elles apparaissent dans
 * l'URL de l'API. `groups` suit l'arbre ADE ; `rooms`, `teachers` et
 * `subjects` — les ressources pédagogiques, R1.01 et consorts — sont des vues
 * transversales, reconstruites à partir des cours de la formation (voir
 * `directory`).
 */
export const RESOURCE_KINDS = ['groups', 'rooms', 'teachers', 'subjects'] as const;

export type ResourceKind = (typeof RESOURCE_KINDS)[number];

export function isResourceKind(value: string): value is ResourceKind {
  return (RESOURCE_KINDS as readonly string[]).includes(value);
}

/**
 * Département fictif qui réunit toutes les formations configurées. Une salle est
 * partagée par tout l'établissement et un enseignant intervient souvent dans
 * plusieurs départements : les chercher formation par formation n'aurait pas de
 * sens, et une salle paraîtrait libre alors qu'une autre formation l'occupe.
 * Réservé aux vues transversales (`rooms`, `teachers`) — l'arbre des groupes,
 * lui, reste propre à une formation.
 */
export const ALL_DEPARTMENTS = 'all';

/** Ville des composantes qu'aucune règle de `ade.json` ne range. */
export const OTHER_CITY = 'autres';

export interface CityInfo {
  id: string;
  label: string;
}

/**
 * Une composante de l'ULCO — IUT INFO, CGU Calais, EILCO Dunkerque… —, que
 * l'application appelle une formation. C'est le premier niveau de l'arbre ADE.
 */
export interface DepartmentInfo {
  id: string;
  label: string;
  city: string;
}

interface Composante extends DepartmentInfo {
  /** Le nœud ADE tel qu'ADE veut le revoir pour en lister les enfants. */
  node: AdeResource;
}

export interface GroupNode {
  id: number;
  name: string;
  path: string;
  depth: number;
  children: GroupNode[];
}

export interface Catalog {
  department: string;
  label: string;
  fetchedAt: string;
  groups: GroupNode[];
}

/** Une salle, un enseignant ou une ressource, avec le nombre de cours qui le concernent. */
export interface DirectoryEntry {
  id: number;
  name: string;
  courses: number;
  /**
   * Ressources seulement. « R1.01 » n'est pas la même matière en informatique
   * et en GEA : une ressource appartient à une formation, et l'intitulé
   * complète le code, qui seul ne parle à personne.
   */
  department?: string;
  label?: string;
  /** Salles seulement : les noms se répètent d'une ville à l'autre. */
  city?: string;
  /**
   * Enseignants seulement : les villes où ils interviennent. Un nom ne dit pas
   * le campus, et certains enseignent sur deux d'entre eux.
   */
  cities?: string[];
  /** Enseignants seulement : les autres formes de leur nom dans ADE (« M. Basse », « BASSE D. »). */
  aliases?: string[];
  /**
   * Enseignants seulement : un nom que rien ne confirme (« Lemoine Chloé »),
   * lu dans une remarque. Proposé à la recherche, à part des autres.
   */
  uncertain?: boolean;
  /**
   * Ressources seulement : qui en assure les séances. Une ressource partagée
   * entre deux enseignants se filtre ainsi, chacun ne gardant que les siennes.
   * `NO_TEACHER` regroupe les séances qu'ADE ne rattache à personne.
   */
  teachers?: Array<{ id: number; name: string; courses: number }>;
}

export interface Directory {
  department: string;
  kind: ResourceKind;
  fetchedAt: string;
  /**
   * Fin du dernier cours de la fenêtre (instant ISO) : la charge de chacun se
   * compte jusque-là, sur plusieurs semaines — pas sur la semaine affichée.
   */
  until: string | null;
  entries: DirectoryEntry[];
}

export interface Schedule {
  department: string;
  kind: ResourceKind;
  /** Pour les ressources, la sélection sous sa forme canonique (voir `formatSelection`). */
  resourceId: number | string;
  resourceName: string;
  /** Début de la fenêtre couverte (ISO `YYYY-MM-DD`). */
  from: string;
  fetchedAt: string;
  events: CourseEvent[];
  /** Présent quand ADE ne répond pas : c'est alors la dernière version connue, datée par `fetchedAt`. */
  stale?: true;
}

/**
 * Profondeur maximale explorée dans l'arbre ADE (garde-fou contre une récursion
 * anormale). Les composantes sont au niveau 1 ; les plus profondes, comme les
 * licences de la CGU, descendent jusqu'au niveau 6.
 */
const MAX_DEPTH = 9;
/**
 * ADE publie douze semaines à partir de la date demandée. Celles de la semaine
 * en cours servent donc aussi pour les onze suivantes : avancer d'une semaine
 * ne redemande rien à ADE (vérifié : les cours communs à deux fenêtres sont
 * identiques).
 */
const WINDOW_WEEKS = 12;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
/** Taille maximale acceptée pour un flux ICS (10 Mo). */
const MAX_ICS_BYTES = 10 * 1024 * 1024;
/**
 * Appels simultanés à ADE, toutes requêtes confondues. ADE reste un serveur
 * partagé : parcourir l'arbre de toute l'ULCO ou rassembler ses cours se fait
 * en file, pas d'un seul coup.
 */
const ADE_CONCURRENCY = 6;
/**
 * Quand ADE ne répond plus, on resert la dernière version connue — jusqu'à une
 * semaine, de quoi couvrir une panne de week-end — et on ne le relance qu'au
 * bout de deux minutes. Quand il est seulement lent, on n'attend pas plus de
 * deux secondes et demie : passé ce délai, le visiteur reçoit la version connue
 * pendant que la nouvelle se charge, pour le suivant.
 */
const FALLBACK: CacheOptions = { staleMs: 7 * 24 * 60 * 60 * 1000, retryMs: 2 * 60 * 1000, patienceMs: 2500 };
/**
 * Après trois échecs d'affilée, ADE est tenu pour en panne : on cesse de
 * l'appeler pendant une minute. Les visiteurs reçoivent aussitôt la version
 * connue au lieu d'attendre chacun un délai d'expiration, et un ADE qui peine à
 * repartir n'est pas noyé sous les requêtes en attente.
 */
const BREAKER_THRESHOLD = 3;
const BREAKER_COOLDOWN_MS = 60 * 1000;

export class NotFoundError extends Error {}

/**
 * Fenêtre ADE d'où tirer la semaine `from` : celle de la semaine en cours quand
 * `from` y tient tout entière, sinon la sienne propre — une semaine passée, ou
 * trop lointaine.
 */
export function windowFor(from: string, now = new Date()): string {
  const current = mondayOf(now);
  const weeks = Math.round((Date.parse(from) - Date.parse(current)) / WEEK_MS);
  return weeks >= 0 && weeks < WINDOW_WEEKS ? current : from;
}

/** Les cours d'une fenêtre à partir du lundi `from`, comme si ADE l'avait publiée depuis ce jour-là. */
function eventsFrom(events: CourseEvent[], window: string, from: string): CourseEvent[] {
  if (window === from) return events;
  const start = new Date(parisMidnight(from)).toISOString();
  return events.filter((event) => event.end > start);
}

/** Le contenu des caches, tel qu'il s'écrit sur disque : chaque cache, ses entrées. */
export type CacheSnapshot = Record<string, Array<[string, unknown, number]>>;

/**
 * File d'attente qui borne le nombre de tâches en cours. Elle ne doit envelopper
 * que des appels réseau, jamais une tâche qui en attend d'autres : celle-ci
 * garderait sa place pendant que ses filles attendent la leur.
 */
class Limiter {
  #free: number;
  readonly #queue: Array<() => void> = [];

  constructor(size: number) {
    this.#free = size;
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.#free > 0) this.#free -= 1;
    else await new Promise<void>((resolve) => this.#queue.push(resolve));
    try {
      return await task();
    } finally {
      const next = this.#queue.shift();
      if (next) next();
      else this.#free += 1;
    }
  }
}

/**
 * Disjoncteur devant ADE. Ouvert, il refuse les appels sans toucher au réseau ;
 * à la fin du délai, il laisse repasser les appels, et le premier échec le
 * rouvre aussitôt — le premier succès le referme.
 */
class Breaker {
  #failures = 0;
  #openUntil = 0;

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (Date.now() < this.#openUntil) throw new AdeError('ADE ne répond pas (appels suspendus)');
    try {
      const result = await task();
      this.#failures = 0;
      return result;
    } catch (err) {
      this.#failures += 1;
      if (this.#failures >= BREAKER_THRESHOLD) this.#openUntil = Date.now() + BREAKER_COOLDOWN_MS;
      throw err;
    }
  }
}

/**
 * ADE renvoie certains noms échappés à la JavaScript, parfois par-dessus une
 * entité HTML : « FCU Côte d\x27Opale », « DAEU \x26quot;A\x26quot; ».
 */
export function decodeAdeName(raw: string): string {
  const entities: Record<string, string> = { quot: '"', amp: '&', apos: "'", '#39': "'", lt: '<', gt: '>' };
  return raw
    .replace(/\\x([0-9a-f]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&(quot|amp|apos|#39|lt|gt);/g, (_, name: string) => entities[name])
    .trim();
}

/**
 * Identifiant d'URL d'une composante, tiré de son nom : « IUT INFO » donne
 * `iut-info`, le même qu'avant l'ouverture à toute l'ULCO — les classes
 * mémorisées et les abonnements aux notifications restent valables.
 */
export function slugOf(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, 32)
    .replace(/-+$/, '');
}

/** Dédoublonne des cours par UID ADE et les range par heure de début. */
function uniqueByUid(events: CourseEvent[]): CourseEvent[] {
  const byUid = new Map<string, CourseEvent>();
  for (const event of events) byUid.set(event.uid, event);
  return [...byUid.values()].sort((a, b) => a.start.localeCompare(b.start));
}

/**
 * Identifiant numérique stable dérivé d'un nom (FNV-1a). Les salles et les
 * enseignants n'ont pas d'identifiant ADE exploitable : on leur en fabrique un,
 * pour que toute l'API — URL, cache, préférences — manipule des entiers.
 */
export function nameId(name: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < name.length; i += 1) {
    h = (h ^ name.charCodeAt(i)) >>> 0;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h % 9_999_999) + 1;
}

/** Clé d'une ressource : son code, dans sa formation. */
function subjectKey(event: CourseEvent): string | null {
  const subject = subjectOf(event);
  return subject ? `${event.department ?? ''}:${subject.key}` : null;
}

/**
 * Semaines qu'il doit rester dans la fenêtre après un cours pour qu'on le dise
 * peut-être le dernier de sa matière. Plus près de la fin de ce qu'ADE a
 * publié, une matière absente n'est pas finie : on ne voit simplement pas
 * encore sa suite. Avec une fenêtre de douze semaines, cela couvre la semaine
 * en cours et la suivante.
 */
const LAST_LOOKAHEAD_WEEKS = 10;

/**
 * Marque `last` les séances après lesquelles leur matière ne revient plus
 * d'ici la fin de la fenêtre `window` — sans rien demander de plus à ADE.
 * Une salle n'est pas concernée : la suite d'une matière peut se tenir
 * ailleurs.
 */
export function markLastSessions(events: CourseEvent[], window: string, kind: ResourceKind): CourseEvent[] {
  if (kind === 'rooms') return events;
  const horizon = parisMidnight(window) + WINDOW_WEEKS * WEEK_MS;
  const keys = events.map(subjectKey);
  const latest = new Map<string, string>();
  events.forEach((event, i) => {
    const key = keys[i];
    if (key && event.start > (latest.get(key) ?? '')) latest.set(key, event.start);
  });
  return events.map((event, i) => {
    const key = keys[i];
    if (!key || event.start !== latest.get(key)) return event;
    if (Date.parse(event.start) + LAST_LOOKAHEAD_WEEKS * WEEK_MS > horizon) return event;
    return { ...event, last: true as const };
  });
}

/**
 * Intitulé retenu pour une ressource, parmi ceux de ses séances : leur début
 * commun s'il y en a un (« Dev Web » pour « Dev Web Mme X » et
 * « Dev Web Symfony »), sinon le plus fréquent. Rien du tout si la plupart des
 * séances n'en portent pas : un nom d'enseignant glissé dans une seule ne
 * nomme pas la matière.
 */
function pickLabel(labels: Map<string, number>): string {
  const named = [...labels.entries()].filter(([label]) => label);
  const namedCount = named.reduce((n, [, count]) => n + count, 0);
  if (named.length === 0 || namedCount < (labels.get('') ?? 0)) return '';

  const words = named.map(([label]) => label.split(' '));
  const common: string[] = [];
  for (let i = 0; words.every((w) => i < w.length && w[i].toLowerCase() === words[0][i].toLowerCase()); i += 1) {
    common.push(words[0][i]);
  }
  if (common.length > 0) return common.join(' ');

  named.sort((a, b) => b[1] - a[1] || a[0].length - b[0].length);
  return named[0][0];
}

/** Une salle ADE peut en désigner plusieurs : « S201,S134 » est un cours en deux salles. */
function roomsOf(event: CourseEvent): string[] {
  return (event.room ?? '')
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean);
}

/**
 * Les salles de Calais gardent l'identifiant qu'elles avaient quand
 * l'application ne couvrait que ses trois départements d'IUT : une salle
 * mémorisée sur un téléphone se retrouve ainsi. Ailleurs, la ville entre dans
 * l'identifiant, puisque les noms se répètent d'un campus à l'autre.
 */
const LEGACY_ROOM_CITY = 'calais';

const roomKey = (city: string, name: string): string => `${city}\n${name}`;

function roomId(city: string, name: string): number {
  return nameId(city === LEGACY_ROOM_CITY ? name : `${city}:${name}`);
}

/** Les salles présentes dans `events`, chacune située dans la ville de sa formation. */
function roomEntries(events: CourseEvent[], cities: Map<string, string>): DirectoryEntry[] {
  const counts = new Map<string, { city: string; name: string; courses: number }>();
  for (const event of events) {
    const city = cities.get(event.department ?? '') ?? OTHER_CITY;
    for (const name of roomsOf(event)) {
      const key = roomKey(city, name);
      const entry = counts.get(key) ?? { city, name, courses: 0 };
      entry.courses += 1;
      counts.set(key, entry);
    }
  }
  return [...counts.values()]
    .map(({ city, name, courses }) => ({ id: roomId(city, name), name, city, courses }))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr') || a.city.localeCompare(b.city));
}

/**
 * Nom retenu pour une ressource sans code, parmi les graphies de ses séances :
 * une qui ne crie pas et commence par une capitale (« Anglais » plutôt que
 * « ANGLAIS » ou « anglais »), la plus fréquente.
 */
function pickName(names: Map<string, number>): string {
  const rank = (name: string) =>
    name === name.toUpperCase() && name !== name.toLowerCase() ? 2 : /^\p{Ll}/u.test(name) ? 1 : 0;
  return [...names.entries()].sort(
    ([a, n], [b, m]) => rank(a) - rank(b) || m - n || a.length - b.length || a.localeCompare(b, 'fr'),
  )[0][0];
}

/** Les ressources présentes dans `events`, chacune avec son intitulé et sa charge. */
function subjectEntries(events: CourseEvent[]): DirectoryEntry[] {
  type Tally = {
    department: string;
    key: string;
    courses: number;
    names: Map<string, number>;
    labels: Map<string, number>;
    teachers: Map<string, number>;
  };
  const byKey = new Map<string, Tally>();
  const count = (map: Map<string, number>, name: string) => map.set(name, (map.get(name) ?? 0) + 1);
  for (const event of events) {
    const subject = subjectOf(event);
    if (!subject) continue;
    const department = event.department ?? '';
    const key = `${department}:${subject.key}`;
    let entry = byKey.get(key);
    if (!entry) {
      entry = { department, key, courses: 0, names: new Map(), labels: new Map(), teachers: new Map() };
      byKey.set(key, entry);
    }
    entry.courses += 1;
    count(entry.names, subject.code);
    count(entry.labels, subject.label);
    // Une séance sans enseignant compte sous le nom vide.
    for (const teacher of event.teachers.length ? event.teachers : ['']) count(entry.teachers, teacher);
  }
  return [...byKey.values()]
    .map((entry) => ({
      id: nameId(entry.key),
      name: pickName(entry.names),
      courses: entry.courses,
      department: entry.department,
      label: pickLabel(entry.labels),
      teachers: [...entry.teachers.entries()]
        .map(([name, courses]) => ({ id: name ? nameId(name) : NO_TEACHER, name, courses }))
        .sort((a, b) => b.courses - a.courses || a.name.localeCompare(b.name, 'fr')),
    }))
    // Ordre naturel : R1.02 avant R1.10, les ressources avant les SAE.
    .sort((a, b) => a.name.localeCompare(b.name, 'fr', { numeric: true }));
}

export class AdeService {
  readonly #config: AppConfig;
  readonly #limiter = new Limiter(ADE_CONCURRENCY);
  readonly #breaker = new Breaker();
  readonly #composantes: TtlCache<Composante[]>;
  readonly #catalogs: TtlCache<Catalog>;
  readonly #icsUrls: TtlCache<string>;
  readonly #schedules: TtlCache<Schedule>;
  readonly #aggregates: TtlCache<CourseEvent[]>;
  readonly #directories: TtlCache<Directory>;

  constructor(config: AppConfig) {
    this.#config = config;
    this.#composantes = new TtlCache<Composante[]>(config.catalogTtlMs, 1, FALLBACK);
    this.#catalogs = new TtlCache<Catalog>(config.catalogTtlMs, 64, FALLBACK);
    // Les URL `.shu` publiées par ADE ne dépendent que du nœud — ni de la
    // session, ni des dates demandées : on les garde une semaine. Il en faut
    // une par nœud parcouru pour rassembler toute l'ULCO.
    this.#icsUrls = new TtlCache<string>(7 * 24 * 60 * 60 * 1000, 5000);
    this.#schedules = new TtlCache<Schedule>(config.scheduleTtlMs, 300, FALLBACK);
    // Toute l'ULCO coûte quelque trois cents flux : rassemblée moins souvent qu'une classe.
    this.#aggregates = new TtlCache<CourseEvent[]>(config.aggregateTtlMs, 128, FALLBACK);
    this.#directories = new TtlCache<Directory>(config.catalogTtlMs, 32, FALLBACK);
  }

  /**
   * Un appel réseau à ADE : à son tour dans la file, et seulement si le
   * disjoncteur le permet — vérifié au moment de partir, pas à l'entrée dans la
   * file, pour qu'une file pleine se vide d'un coup quand ADE tombe.
   */
  #ade<T>(task: () => Promise<T>): Promise<T> {
    return this.#limiter.run(() => this.#breaker.run(task));
  }

  /** Tout ce qui vient d'ADE, sauf ce qui s'en déduit sans lui (les annuaires). */
  #persisted(): Record<string, TtlCache<unknown>> {
    return {
      composantes: this.#composantes,
      catalogs: this.#catalogs,
      icsUrls: this.#icsUrls,
      schedules: this.#schedules,
      aggregates: this.#aggregates,
    };
  }

  /** Change dès qu'une donnée d'ADE a été rechargée : il est alors temps de sauvegarder. */
  get revision(): number {
    return Object.values(this.#persisted()).reduce((sum, cache) => sum + cache.revision, 0);
  }

  /**
   * Les données d'ADE, pour les écrire sur disque. Un redémarrage pendant une
   * panne d'ADE garde ainsi de quoi servir, et ne reparcourt pas tout l'arbre.
   */
  snapshot(): CacheSnapshot {
    return Object.fromEntries(Object.entries(this.#persisted()).map(([name, cache]) => [name, cache.dump()]));
  }

  restore(snapshot: CacheSnapshot): void {
    for (const [name, cache] of Object.entries(this.#persisted())) {
      for (const [key, value, storedAt] of snapshot[name] ?? []) cache.restore(key, value, storedAt);
    }
  }

  #client(): AdeClient {
    const { origin, token, projectId, relay } = this.#config.ade;
    return new AdeClient({ origin, token, projectId, relay });
  }

  /** Ville d'une composante : la table tenue à la main d'abord, puis son nom. */
  #cityOf(label: string): string {
    const { composantes, cities } = this.#config.campus;
    return composantes[label] ?? cities.find((city) => city.pattern.test(label))?.id ?? OTHER_CITY;
  }

  /** Les composantes de l'établissement : le premier niveau de l'arbre ADE. */
  async #list(): Promise<Composante[]> {
    return this.#composantes.get('all', async () => {
      const client = this.#client();
      await this.#ade(() => client.connect());
      const roots = await this.#ade(() => client.children({ id: -1 }));
      const taken = new Set<string>([ALL_DEPARTMENTS]);
      return roots.map((node) => {
        const label = decodeAdeName(node.name);
        let id = slugOf(label) || `c${node.id}`;
        if (taken.has(id)) id = `${id.slice(0, 24)}-${node.id}`;
        taken.add(id);
        return { id, label, city: this.#cityOf(label), node };
      });
    });
  }

  /** Les villes et leurs formations, pour l'écran de choix. */
  async departments(): Promise<{ cities: CityInfo[]; departments: DepartmentInfo[] }> {
    const list = await this.#list();
    const cities: CityInfo[] = this.#config.campus.cities.map(({ id, label }) => ({ id, label }));
    // Une composante apparue depuis, et qu'aucune règle ne range : à part plutôt que perdue.
    if (list.some((d) => d.city === OTHER_CITY)) cities.push({ id: OTHER_CITY, label: 'Autres' });
    return {
      cities,
      departments: list
        .map(({ id, label, city }) => ({ id, label, city }))
        .sort((a, b) => a.label.localeCompare(b.label, 'fr')),
    };
  }

  /**
   * Ville d'une formation, ou `null` si on ne la connaît pas — `all`, une
   * formation inconnue, ou ADE injoignable : le menu du Crous s'en passe.
   */
  async cityOf(departmentId: string): Promise<string | null> {
    try {
      return (await this.#list()).find((d) => d.id === departmentId)?.city ?? null;
    } catch {
      return null;
    }
  }

  async #department(id: string): Promise<Composante> {
    const found = (await this.#list()).find((d) => d.id === id);
    if (!found) throw new NotFoundError(`Département inconnu : ${id}`);
    return found;
  }

  /**
   * Départements visés par une requête : un seul, ou tous quand l'appelant
   * demande `all`.
   */
  async #departmentIds(id: string): Promise<string[]> {
    if (id === ALL_DEPARTMENTS) return (await this.#list()).map((d) => d.id);
    return [(await this.#department(id)).id];
  }

  /** Arbre des groupes d'un département (mis en cache). */
  async catalog(departmentId: string): Promise<Catalog> {
    const dept = await this.#department(departmentId);
    return this.#catalogs.get(dept.id, async () => {
      const client = this.#client();
      await this.#ade(() => client.connect());
      // La composante est au premier niveau de l'arbre ADE ; ses enfants, au second.
      const children = await this.#ade(() => client.children({ ...dept.node, depth: 1 }));
      const groups = await Promise.all(children.map((c) => this.#walk(client, c, 2)));
      return {
        department: dept.id,
        label: dept.label,
        fetchedAt: new Date().toISOString(),
        groups,
      };
    });
  }

  async #walk(client: AdeClient, node: AdeResource, depth: number): Promise<GroupNode> {
    const children =
      depth >= MAX_DEPTH ? [] : await this.#ade(() => client.children({ ...node, depth }));
    return {
      id: node.id,
      name: decodeAdeName(node.name),
      path: node.path,
      depth,
      children: await Promise.all(children.map((c) => this.#walk(client, c, depth + 1))),
    };
  }

  /** Recherche un groupe dans le catalogue — sert aussi de validation d'entrée. */
  async findGroup(departmentId: string, groupId: number): Promise<GroupNode> {
    const catalog = await this.catalog(departmentId);
    const stack = [...catalog.groups];
    while (stack.length > 0) {
      const node = stack.pop()!;
      if (node.id === groupId) return node;
      stack.push(...node.children);
    }
    throw new NotFoundError(`Groupe inconnu : ${groupId}`);
  }

  /**
   * Emploi du temps d'un groupe à partir du lundi `from` (ISO `YYYY-MM-DD`).
   * ADE renvoie une fenêtre glissante d'environ douze semaines à partir de cette date.
   */
  async schedule(departmentId: string, groupId: number, from: string): Promise<Schedule> {
    const dept = await this.#department(departmentId);
    const group = await this.findGroup(dept.id, groupId);

    const window = windowFor(from);
    const { value, stale } = await this.#schedules.lookup(`${dept.id}:${groupId}:${window}`, async () => ({
      department: dept.id,
      kind: 'groups' as const,
      resourceId: groupId,
      resourceName: group.name,
      from: window,
      fetchedAt: new Date().toISOString(),
      events: await this.#gather(dept, group, window),
    }));
    const events = markLastSessions(eventsFrom(value.events, window, from), window, 'groups');
    const schedule = { ...value, from, events };
    return stale ? { ...schedule, stale } : schedule;
  }

  /**
   * Cours d'un nœud de l'arbre et de toute sa descendance.
   *
   * ADE publie volontiers le flux d'un nœud entier — un département d'IUT d'un
   * seul tenant —, mais au-delà d'une certaine taille il répond une page vide au
   * lieu d'un calendrier : on redescend alors d'un niveau. Toute l'ULCO tient
   * ainsi en moins de trois cents flux, là où il y a plus de deux mille groupes.
   */
  async #gather(dept: Composante, node: { id: number; children: GroupNode[] }, from: string): Promise<CourseEvent[]> {
    const ics = await this.#icsOf(node.id, from);
    if (ics !== null) {
      // Chaque cours retient d'où il vient : c'est sa formation qui dit sur
      // quelle grille horaire le recaler, y compris dans une vue transversale.
      return parseAdeIcs(ics).map((event) => ({ ...event, department: dept.id }));
    }
    if (node.children.length === 0) throw new AdeError(`ADE refuse de publier le groupe ${node.id}`);
    const parts = await Promise.all(node.children.map((child) => this.#gather(dept, child, from)));
    return uniqueByUid(parts.flat());
  }

  /** Flux iCalendar d'un nœud, ou `null` si ADE le juge trop gros pour le publier d'un bloc. */
  async #icsOf(resourceId: number, from: string): Promise<string | null> {
    const url = await this.#icsUrls.get(String(resourceId), async () => {
      const client = this.#client();
      await this.#ade(() => client.connect());
      return this.#ade(() => client.icsUrl(resourceId, from, from));
    });
    return this.#ade(() => this.#fetchIcs(url, from));
  }

  /**
   * Tous les cours de la formation sur la fenêtre `from`, toutes classes confondues.
   *
   * ADE ne publie pas de flux par salle exploitable — son arbre des salles
   * s'arrête à l'étage, et son arbre des enseignants est tronqué par le serveur —
   * alors qu'un cours porte déjà sa salle et ses intervenants. On réunit donc
   * les cours de toute la formation, et on les dédoublonne : un cours partagé
   * par deux groupes est une seule et même séance (même UID).
   */
  async #allEvents(departmentId: string, from: string): Promise<Lookup<CourseEvent[]>> {
    if (departmentId === ALL_DEPARTMENTS) {
      const perDepartment = await Promise.all(
        (await this.#departmentIds(ALL_DEPARTMENTS)).map((id) => this.#allEvents(id, from)),
      );
      // Un cours mutualisé entre deux formations garde le même UID ADE :
      // le dédoublonnage vaut donc aussi entre départements.
      return {
        value: uniqueByUid(perDepartment.flatMap((d) => d.value)),
        // L'ensemble a l'âge de sa part la plus ancienne.
        storedAt: Math.min(...perDepartment.map((d) => d.storedAt)),
        stale: perDepartment.some((d) => d.stale),
      };
    }

    const dept = await this.#department(departmentId);
    return this.#aggregates.lookup(`${dept.id}:${from}`, async () => {
      const catalog = await this.catalog(dept.id);
      return this.#gather(dept, { id: dept.node.id, children: catalog.groups }, from);
    });
  }

  /** Ville de chaque formation, pour situer les salles. */
  async #cities(): Promise<Map<string, string>> {
    return new Map((await this.#list()).map((d) => [d.id, d.city]));
  }

  /**
   * Liste des salles, des enseignants ou des ressources de la formation, avec
   * leur charge. Construite sur la fenêtre en cours — soit environ douze
   * semaines, assez pour que la liste soit stable d'un jour à l'autre.
   */
  async directory(departmentId: string, kind: ResourceKind, from: string): Promise<Directory> {
    if (kind === 'groups') throw new NotFoundError('Les groupes se consultent via le catalogue.');
    // Valide `departmentId` : `all`, ou une formation connue.
    await this.#departmentIds(departmentId);

    // L'annuaire se construit sur la fenêtre : le même pour toutes les semaines qu'elle couvre.
    const window = windowFor(from);
    return this.#directories.get(`${departmentId}:${kind}:${window}`, async () => {
      const { value: events } = await this.#allEvents(departmentId, window);
      const fetchedAt = new Date().toISOString();
      const until = events.reduce<string | null>((last, e) => (!last || e.end > last ? e.end : last), null);
      if (kind === 'subjects') {
        return { department: departmentId, kind, fetchedAt, until, entries: subjectEntries(events) };
      }
      if (kind === 'rooms') {
        return { department: departmentId, kind, fetchedAt, until, entries: roomEntries(events, await this.#cities()) };
      }
      const cities = await this.#cities();
      // « M. Basse » et « BASSE David » sont la même personne : un seul nom dans la liste.
      const aliases = teacherAliases(
        events.flatMap((e) => e.teachers),
        events.flatMap((e) => e.notes ?? []),
      );
      type Tally = { courses: number; cities: Set<string>; aliases: Set<string> };
      const counts = new Map<string, Tally>();
      const uncertain = new Map<string, Tally>();
      const tally = (into: Map<string, Tally>, name: string, forms: string[], city: string) => {
        const entry = into.get(name) ?? { courses: 0, cities: new Set<string>(), aliases: new Set<string>() };
        entry.courses += 1;
        entry.cities.add(city);
        for (const raw of forms) if (raw !== name) entry.aliases.add(raw);
        into.set(name, entry);
      };
      for (const event of events) {
        const city = cities.get(event.department ?? '') ?? OTHER_CITY;
        // Chaque enseignant compte une fois par cours, sous quelque forme qu'il y figure.
        const named = new Map<string, string[]>();
        for (const raw of [...event.teachers, ...(event.notes ?? []).filter((note) => aliases.has(note))]) {
          const name = aliases.get(raw) ?? raw;
          named.set(name, [...(named.get(name) ?? []), raw]);
        }
        for (const [name, forms] of named) tally(counts, name, forms, city);
        for (const note of new Set(event.notes ?? [])) {
          const name = aliases.has(note) ? null : nameLike(note);
          if (name) tally(uncertain, name, [note], city);
        }
      }
      const entryOf = (name: string, entry: Tally) => ({
        id: nameId(name),
        name,
        courses: entry.courses,
        cities: [...entry.cities].sort(),
        ...(entry.aliases.size ? { aliases: [...entry.aliases].sort() } : {}),
      });
      const entries: DirectoryEntry[] = [
        ...[...counts].map(([name, entry]) => entryOf(name, entry)),
        ...[...uncertain]
          .filter(([name]) => !counts.has(name))
          .map(([name, entry]) => ({ ...entryOf(name, entry), uncertain: true })),
      ].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
      return { department: departmentId, kind, fetchedAt, until, entries };
    });
  }

  /**
   * Emploi du temps d'une salle, d'un enseignant ou d'une ressource : tous les
   * cours de la formation qui la — ou le — concernent, sans distinction de
   * classe. Les ressources se réunissent : un vacataire qui assure R1.01 en
   * informatique et R3.04 en GEA les voit côte à côte, même quand ADE ne
   * connaît pas son nom.
   */
  async facetSchedule(
    departmentId: string,
    kind: ResourceKind,
    /** Une salle ou un enseignant ; pour les ressources, la sélection. */
    target: number | SubjectPick[],
    from: string,
  ): Promise<Schedule> {
    if (Array.isArray(target) !== (kind === 'subjects')) {
      throw new NotFoundError('Une sélection ne vaut que pour les ressources.');
    }
    const picks = Array.isArray(target) ? target : [{ id: target, without: [] }];
    const resourceIds = picks.map((p) => p.id);
    const without = new Map(picks.map((p) => [p.id, new Set(p.without)]));
    const directory = await this.directory(departmentId, kind, from);
    const entries = resourceIds.map((id) => {
      const entry = directory.entries.find((e) => e.id === id);
      if (!entry) throw new NotFoundError(`Ressource inconnue : ${id}`);
      return entry;
    });
    const names = new Set(entries.flatMap((e) => [e.name, ...(e.aliases ?? [])]));
    // Une salle se désigne par sa ville et son nom : « SALLE 25 » existe à Boulogne comme à Dunkerque.
    const rooms = new Set(entries.map((e) => roomKey(e.city ?? '', e.name)));
    const cities = kind === 'rooms' ? await this.#cities() : new Map<string, string>();

    const window = windowFor(from);
    const { value: all, storedAt, stale } = await this.#allEvents(departmentId, window);
    const events = eventsFrom(all, window, from);
    const matches = events.filter((event) => {
      if (kind === 'rooms') {
        const city = cities.get(event.department ?? '') ?? OTHER_CITY;
        return roomsOf(event).some((room) => rooms.has(roomKey(city, room)));
      }
      if (kind === 'teachers') {
        return event.teachers.some((teacher) => names.has(teacher)) || (event.notes ?? []).some((note) => names.has(note));
      }
      const key = subjectKey(event);
      const excluded = key === null ? undefined : without.get(nameId(key));
      if (!excluded) return false;
      // Une séance reste tant qu'un de ses enseignants n'est pas écarté.
      const teachers = event.teachers.length ? event.teachers.map(nameId) : [NO_TEACHER];
      return teachers.some((t) => !excluded.has(t));
    });

    return {
      department: departmentId,
      kind,
      resourceId: Array.isArray(target) ? formatSelection(target) : target,
      resourceName: entries.map((e) => e.name).join(', '),
      from,
      fetchedAt: new Date(storedAt).toISOString(),
      events: markLastSessions(matches, window, kind),
      ...(stale ? { stale } : {}),
    };
  }

  /**
   * Remplit les caches au démarrage : l'arbre de toute l'ULCO compte plus de
   * trois mille nœuds, qu'il vaut mieux parcourir avant le premier visiteur
   * qu'à sa place. Seules les formations absentes du disque sont parcourues :
   * les autres, même anciennes, se rafraîchiront quand on les consultera — un
   * redéploiement ne relance pas des milliers d'appels.
   */
  async warmUp(): Promise<void> {
    for (const dept of await this.#list()) {
      if (!this.#catalogs.has(dept.id)) await this.catalog(dept.id);
    }
  }

  /** Le flux, ou `null` quand ADE renvoie sa page vide au lieu d'un calendrier. */
  async #fetchIcs(url: string, from: string): Promise<string | null> {
    // Défense en profondeur : l'URL vient d'ADE, on revérifie qu'elle reste sur son domaine.
    const target = new URL(url);
    if (target.origin !== this.#config.ade.origin) throw new AdeError('Flux iCalendar hors du domaine ADE attendu');
    target.searchParams.set('firstDate', from);

    const res = await reach(target, {
      redirect: 'error',
      signal: AbortSignal.timeout(20_000),
      headers: { Accept: 'text/calendar' },
    }, this.#config.ade.relay);
    if (!res.ok) throw new AdeError(`ADE a répondu ${res.status} pour le flux iCalendar`);

    const declared = Number(res.headers.get('content-length') ?? 0);
    if (declared > MAX_ICS_BYTES) throw new AdeError('Flux iCalendar trop volumineux');

    const body = await res.text();
    if (body.length > MAX_ICS_BYTES) throw new AdeError('Flux iCalendar trop volumineux');
    if (body.startsWith('BEGIN:VCALENDAR')) return body;
    if (/<html/i.test(body)) return null;
    throw new AdeError("ADE n'a pas renvoyé un flux iCalendar");
  }
}
