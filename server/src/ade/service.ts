import { AdeClient, AdeError, type AdeResource } from './gwt.ts';
import { parseAdeIcs, type CourseEvent } from './ics.ts';
import { TtlCache } from '../cache.ts';
import type { AppConfig, Department } from '../config.ts';

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

export interface Schedule {
  department: string;
  groupId: number;
  groupName: string;
  /** Début de la fenêtre couverte (ISO `YYYY-MM-DD`). */
  from: string;
  fetchedAt: string;
  events: CourseEvent[];
}

/** Profondeur maximale explorée dans l'arbre ADE (garde-fou contre une récursion anormale). */
const MAX_DEPTH = 6;
/** Taille maximale acceptée pour un flux ICS (10 Mo). */
const MAX_ICS_BYTES = 10 * 1024 * 1024;

export class NotFoundError extends Error {}

export class AdeService {
  readonly #config: AppConfig;
  readonly #catalogs: TtlCache<Catalog>;
  readonly #icsUrls: TtlCache<string>;
  readonly #schedules: TtlCache<Schedule>;

  constructor(config: AppConfig) {
    this.#config = config;
    this.#catalogs = new TtlCache<Catalog>(config.catalogTtlMs, 32);
    // Les URL `.shu` publiées par ADE sont stables : on les garde une journée.
    this.#icsUrls = new TtlCache<string>(24 * 60 * 60 * 1000, 500);
    this.#schedules = new TtlCache<Schedule>(config.scheduleTtlMs, 300);
  }

  departments(): Array<{ id: string; label: string }> {
    return this.#config.departments.map(({ id, label }) => ({ id, label }));
  }

  #department(id: string): Department {
    const found = this.#config.departments.find((d) => d.id === id);
    if (!found) throw new NotFoundError(`Département inconnu : ${id}`);
    return found;
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
        groupId,
        groupName: group.name,
        from,
        fetchedAt: new Date().toISOString(),
        events: parseAdeIcs(ics),
      };
    });
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
