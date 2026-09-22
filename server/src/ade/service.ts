import { AdeClient, AdeError, type AdeResource } from './gwt.ts';
import { parseAdeIcs, type CourseEvent } from './ics.ts';
import { TtlCache } from '../cache.ts';
import type { AppConfig, Department } from '../config.ts';

/**
 * Les trois façons de consulter un emploi du temps, telles qu'elles apparaissent
 * dans l'URL de l'API. `groups` suit l'arbre ADE ; `rooms` et `teachers` sont
 * des vues transversales, reconstruites à partir des cours de la formation
 * (voir `directory`).
 */
export const RESOURCE_KINDS = ['groups', 'rooms', 'teachers'] as const;

export type ResourceKind = (typeof RESOURCE_KINDS)[number];

export function isResourceKind(value: string): value is ResourceKind {
  return (RESOURCE_KINDS as readonly string[]).includes(value);
}

/**
 * Département fictif qui réunit toutes les formations configurées. Un
 * enseignant intervient souvent dans plusieurs départements : le chercher
 * n'aurait pas de sens formation par formation. Réservé aux vues transversales
 * (`rooms`, `teachers`) — l'arbre des groupes, lui, reste propre à une formation.
 */
export const ALL_DEPARTMENTS = 'all';

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

/** Une salle ou un enseignant, avec le nombre de cours qui le concernent. */
export interface DirectoryEntry {
  id: number;
  name: string;
  courses: number;
}

export interface Directory {
  department: string;
  kind: ResourceKind;
  fetchedAt: string;
  entries: DirectoryEntry[];
}

export interface Schedule {
  department: string;
  kind: ResourceKind;
  resourceId: number;
  resourceName: string;
  /** Début de la fenêtre couverte (ISO `YYYY-MM-DD`). */
  from: string;
  fetchedAt: string;
  events: CourseEvent[];
}

/** Profondeur maximale explorée dans l'arbre ADE (garde-fou contre une récursion anormale). */
const MAX_DEPTH = 6;
/** Taille maximale acceptée pour un flux ICS (10 Mo). */
const MAX_ICS_BYTES = 10 * 1024 * 1024;
/**
 * Emplois du temps demandés simultanément lorsqu'on rassemble toute la formation.
 * ADE reste un serveur partagé : on étale les requêtes plutôt que de les lancer
 * toutes d'un coup.
 */
const AGGREGATE_CONCURRENCY = 4;

export class NotFoundError extends Error {}

/** Exécute `task` sur chaque élément, `limit` à la fois, en préservant l'ordre. */
async function mapWithLimit<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (let i = next; i < items.length; i = next) {
      next += 1;
      out[i] = await task(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * Identifiant numérique stable dérivé d'un nom (FNV-1a). Les salles et les
 * enseignants n'ont pas d'identifiant ADE exploitable : on leur en fabrique un,
 * pour que toute l'API — URL, cache, préférences — manipule des entiers.
 */
function nameId(name: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < name.length; i += 1) {
    h = (h ^ name.charCodeAt(i)) >>> 0;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h % 9_999_999) + 1;
}

/** Une salle ADE peut en désigner plusieurs : « S201,S134 » est un cours en deux salles. */
function roomsOf(event: CourseEvent): string[] {
  return (event.room ?? '')
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean);
}

export class AdeService {
  readonly #config: AppConfig;
  readonly #catalogs: TtlCache<Catalog>;
  readonly #icsUrls: TtlCache<string>;
  readonly #schedules: TtlCache<Schedule>;
  readonly #aggregates: TtlCache<CourseEvent[]>;
  readonly #directories: TtlCache<Directory>;

  constructor(config: AppConfig) {
    this.#config = config;
    this.#catalogs = new TtlCache<Catalog>(config.catalogTtlMs, 32);
    // Les URL `.shu` publiées par ADE sont stables : on les garde une journée.
    this.#icsUrls = new TtlCache<string>(24 * 60 * 60 * 1000, 500);
    this.#schedules = new TtlCache<Schedule>(config.scheduleTtlMs, 300);
    this.#aggregates = new TtlCache<CourseEvent[]>(config.scheduleTtlMs, 32);
    this.#directories = new TtlCache<Directory>(config.catalogTtlMs, 32);
  }

  departments(): Array<{ id: string; label: string }> {
    return this.#config.departments.map(({ id, label }) => ({ id, label }));
  }

  #department(id: string): Department {
    const found = this.#config.departments.find((d) => d.id === id);
    if (!found) throw new NotFoundError(`Département inconnu : ${id}`);
    return found;
  }

  /**
   * Départements visés par une requête : un seul, ou tous quand l'appelant
   * demande `all`.
   */
  #departmentIds(id: string): string[] {
    if (id === ALL_DEPARTMENTS) return this.#config.departments.map((d) => d.id);
    return [this.#department(id).id];
  }

  #client(dept: Department): AdeClient {
    return new AdeClient({ origin: dept.origin, token: dept.token, projectId: dept.projectId });
  }

  /** Arbre des groupes d'un département (mis en cache). */
  async catalog(departmentId: string): Promise<Catalog> {
    const dept = this.#department(departmentId);
    return this.#catalogs.get(dept.id, async () => {
      const client = this.#client(dept);
      await client.connect();
      const roots = await client.children({ id: -1 });
      const groups = await Promise.all(roots.map((r) => this.#walk(client, r, 1)));
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
      depth >= MAX_DEPTH ? [] : await client.children({ ...node, depth });
    return {
      id: node.id,
      name: node.name,
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
    const dept = this.#department(departmentId);
    const group = await this.findGroup(dept.id, groupId);

    return this.#schedules.get(`${dept.id}:${groupId}:${from}`, async () => {
      const url = await this.#icsUrls.get(`${dept.id}:${groupId}`, async () => {
        const client = this.#client(dept);
        await client.connect();
        return client.icsUrl(groupId, from, from);
      });

      const ics = await this.#fetchIcs(dept, url, from);
      return {
        department: dept.id,
        kind: 'groups',
        resourceId: groupId,
        resourceName: group.name,
        from,
        fetchedAt: new Date().toISOString(),
        events: parseAdeIcs(ics),
      };
    });
  }

  /**
   * Groupes sans enfant du catalogue : ce sont eux qui portent les cours.
   * Les nœuds intermédiaires (promotion, TD) reprendraient les mêmes séances.
   */
  async #leafGroups(departmentId: string): Promise<GroupNode[]> {
    const catalog = await this.catalog(departmentId);
    const leaves: GroupNode[] = [];
    const walk = (nodes: GroupNode[]): void => {
      for (const node of nodes) {
        if (node.children.length === 0) leaves.push(node);
        else walk(node.children);
      }
    };
    walk(catalog.groups);
    return leaves;
  }

  /**
   * Tous les cours de la formation sur la fenêtre `from`, toutes classes confondues.
   *
   * ADE ne publie pas de flux par salle exploitable — son arbre des salles
   * s'arrête à l'étage, et son arbre des enseignants est tronqué par le serveur —
   * alors qu'un cours porte déjà sa salle et ses intervenants. On réunit donc
   * les emplois du temps des groupes, déjà en cache, et on les dédoublonne :
   * un cours partagé par deux groupes est une seule et même séance (même UID).
   */
  async #allEvents(departmentId: string, from: string): Promise<CourseEvent[]> {
    if (departmentId === ALL_DEPARTMENTS) {
      const perDepartment = await Promise.all(
        this.#departmentIds(ALL_DEPARTMENTS).map((id) => this.#allEvents(id, from)),
      );
      // Un cours mutualisé entre deux formations garde le même UID ADE :
      // le dédoublonnage vaut donc aussi entre départements.
      const byUid = new Map<string, CourseEvent>();
      for (const events of perDepartment) {
        for (const event of events) byUid.set(event.uid, event);
      }
      return [...byUid.values()].sort((a, b) => a.start.localeCompare(b.start));
    }

    const dept = this.#department(departmentId);
    return this.#aggregates.get(`${dept.id}:${from}`, async () => {
      const groups = await this.#leafGroups(dept.id);
      const schedules = await mapWithLimit(groups, AGGREGATE_CONCURRENCY, (group) =>
        this.schedule(dept.id, group.id, from),
      );
      const byUid = new Map<string, CourseEvent>();
      for (const schedule of schedules) {
        for (const event of schedule.events) byUid.set(event.uid, event);
      }
      return [...byUid.values()].sort((a, b) => a.start.localeCompare(b.start));
    });
  }

  /**
   * Liste des salles ou des enseignants de la formation, avec leur charge.
   * Construite sur la fenêtre en cours — soit environ douze semaines, assez
   * pour que la liste soit stable d'un jour à l'autre.
   */
  async directory(departmentId: string, kind: ResourceKind, from: string): Promise<Directory> {
    if (kind === 'groups') throw new NotFoundError('Les groupes se consultent via le catalogue.');
    // Valide `departmentId` : `all`, ou une formation connue.
    this.#departmentIds(departmentId);

    return this.#directories.get(`${departmentId}:${kind}:${from}`, async () => {
      const events = await this.#allEvents(departmentId, from);
      const counts = new Map<string, number>();
      for (const event of events) {
        for (const name of kind === 'rooms' ? roomsOf(event) : event.teachers) {
          counts.set(name, (counts.get(name) ?? 0) + 1);
        }
      }
      const entries = [...counts.entries()]
        .map(([name, courses]) => ({ id: nameId(name), name, courses }))
        .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
      return { department: departmentId, kind, fetchedAt: new Date().toISOString(), entries };
    });
  }

  /**
   * Emploi du temps d'une salle ou d'un enseignant : tous les cours de la
   * formation qui la — ou le — concernent, sans distinction de classe.
   */
  async facetSchedule(
    departmentId: string,
    kind: ResourceKind,
    resourceId: number,
    from: string,
  ): Promise<Schedule> {
    const directory = await this.directory(departmentId, kind, from);
    const entry = directory.entries.find((e) => e.id === resourceId);
    if (!entry) throw new NotFoundError(`Ressource inconnue : ${resourceId}`);

    const events = await this.#allEvents(departmentId, from);
    const matches = events.filter((event) =>
      kind === 'rooms' ? roomsOf(event).includes(entry.name) : event.teachers.includes(entry.name),
    );

    return {
      department: departmentId,
      kind,
      resourceId,
      resourceName: entry.name,
      from,
      fetchedAt: new Date().toISOString(),
      events: matches,
    };
  }

  async #fetchIcs(dept: Department, url: string, from: string): Promise<string> {
    // Défense en profondeur : l'URL vient d'ADE, on revérifie qu'elle reste sur son domaine.
    const target = new URL(url);
    if (target.origin !== dept.origin) throw new AdeError('Flux iCalendar hors du domaine ADE attendu');
    target.searchParams.set('firstDate', from);

    const res = await fetch(target, {
      redirect: 'error',
      signal: AbortSignal.timeout(20_000),
      headers: { Accept: 'text/calendar' },
    });
    if (!res.ok) throw new AdeError(`ADE a répondu ${res.status} pour le flux iCalendar`);

    const declared = Number(res.headers.get('content-length') ?? 0);
    if (declared > MAX_ICS_BYTES) throw new AdeError('Flux iCalendar trop volumineux');

    const body = await res.text();
    if (body.length > MAX_ICS_BYTES) throw new AdeError('Flux iCalendar trop volumineux');
    if (!body.startsWith('BEGIN:VCALENDAR')) throw new AdeError("ADE n'a pas renvoyé un flux iCalendar");
    return body;
  }
}
