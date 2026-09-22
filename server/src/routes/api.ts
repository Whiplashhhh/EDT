import type { FastifyInstance } from 'fastify';
import { isResourceKind, type AdeService, type ResourceKind, type Schedule } from '../ade/service.ts';
import type { CrousService } from '../crous/service.ts';

const DEPARTMENT_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Lundi de la semaine contenant `date`, en heure de Paris. */
export function mondayOf(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const shift = days.indexOf(map.weekday as string);
  const local = new Date(`${map.year}-${map.month}-${map.day}T00:00:00Z`);
  local.setUTCDate(local.getUTCDate() - (shift < 0 ? 0 : shift));
  return local.toISOString().slice(0, 10);
}

/** Valide et normalise le paramètre `from` : une date ISO, ramenée au lundi. */
function normalizeFrom(raw: unknown): string {
  if (raw === undefined || raw === null || raw === '') return mondayOf(new Date());
  if (typeof raw !== 'string' || !DATE_RE.test(raw)) {
    throw Object.assign(new Error('Paramètre `from` invalide (format attendu : AAAA-MM-JJ).'), { statusCode: 400 });
  }
  const parsed = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw Object.assign(new Error('Paramètre `from` invalide.'), { statusCode: 400 });
  }
  // Fenêtre raisonnable : deux ans autour d'aujourd'hui.
  const delta = Math.abs(parsed.getTime() - Date.now());
  if (delta > 2 * 365 * 24 * 60 * 60 * 1000) {
    throw Object.assign(new Error('Paramètre `from` hors de la plage autorisée.'), { statusCode: 400 });
  }
  return mondayOf(parsed);
}

function parseDepartment(raw: string | undefined): string {
  const department = raw ?? '';
  if (!DEPARTMENT_RE.test(department)) {
    throw Object.assign(new Error('Département invalide.'), { statusCode: 400 });
  }
  return department;
}

/** Façon de consulter l'emploi du temps : `groups`, `rooms` ou `teachers`. */
function parseKind(raw: string | undefined): ResourceKind {
  if (!raw || !isResourceKind(raw)) {
    throw Object.assign(new Error('Type de ressource inconnu.'), { statusCode: 404 });
  }
  return raw;
}

function parseIds(params: Record<string, string>): { department: string; kind: ResourceKind; resourceId: number } {
  const department = parseDepartment(params.department);
  const kind = parseKind(params.kind);
  const resourceId = Number(params.resourceId);
  if (!Number.isInteger(resourceId) || resourceId <= 0 || resourceId > 10_000_000) {
    throw Object.assign(new Error('Identifiant de ressource invalide.'), { statusCode: 400 });
  }
  return { department, kind, resourceId };
}

export async function registerApi(
  app: FastifyInstance,
  opts: { service: AdeService; crous: CrousService },
): Promise<void> {
  const { service, crous } = opts;

  /** Un emploi du temps, quelle que soit la façon de le consulter. */
  const scheduleOf = (
    department: string,
    kind: ResourceKind,
    resourceId: number,
    from: string,
  ): Promise<Schedule> =>
    kind === 'groups'
      ? service.schedule(department, resourceId, from)
      : service.facetSchedule(department, kind, resourceId, from);

  app.get('/health', async () => ({ status: 'ok' }));

  // Menu du restaurant universitaire de l'établissement : un seul restaurant,
  // fixé par la configuration, donc pas de paramètre côté client.
  app.get('/crous/menu', async (_req, reply) => {
    const menu = await crous.menu();
    reply.header('Cache-Control', 'public, max-age=1800');
    return menu;
  });

  app.get('/departments', async (_req, reply) => {
    reply.header('Cache-Control', 'public, max-age=3600');
    return { departments: service.departments() };
  });

  app.get<{ Params: Record<string, string> }>('/:department/groups', async (req, reply) => {
    const department = parseDepartment(req.params.department);
    const catalog = await service.catalog(department);
    reply.header('Cache-Control', 'public, max-age=1800');
    return catalog;
  });

  /*
   * Annuaire des salles et des enseignants. À la différence des groupes, ce ne
   * sont pas des branches de l'arbre ADE mais des vues transversales : elles se
   * déduisent des cours eux-mêmes, qui portent déjà salle et intervenants.
   */
  app.get<{ Params: Record<string, string>; Querystring: { from?: string } }>(
    '/:department/:kind',
    async (req, reply) => {
      const department = parseDepartment(req.params.department);
      const kind = parseKind(req.params.kind);
      const from = normalizeFrom(req.query.from);
      const directory = await service.directory(department, kind, from);
      reply.header('Cache-Control', 'public, max-age=1800');
      return directory;
    },
  );

  app.get<{ Params: Record<string, string>; Querystring: { from?: string } }>(
    '/:department/:kind/:resourceId/schedule',
    async (req, reply) => {
      const { department, kind, resourceId } = parseIds(req.params);
      const from = normalizeFrom(req.query.from);
      const schedule = await scheduleOf(department, kind, resourceId, from);
      reply.header('Cache-Control', 'public, max-age=300');
      return schedule;
    },
  );

  // Flux iCalendar réexposé : permet de s'abonner depuis l'app Calendrier du téléphone.
  app.get<{ Params: Record<string, string> }>(
    '/:department/:kind/:resourceId/calendar.ics',
    async (req, reply) => {
      const { department, kind, resourceId } = parseIds(req.params);
      const from = mondayOf(new Date());
      const schedule = await scheduleOf(department, kind, resourceId, from);
      reply
        .header('Content-Type', 'text/calendar; charset=utf-8')
        // Le nom vient d'ADE : on le réduit à un jeu de caractères sûr pour un en-tête.
        .header('Content-Disposition', `inline; filename="edt-${safeFilename(schedule.resourceName)}.ics"`)
        .header('Cache-Control', 'public, max-age=900');
      return toIcs(schedule.resourceName, schedule.events);
    },
  );
}

function safeFilename(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 64) || 'calendrier';
}

function icsEscape(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n?|\n/g, '\\n');
}

function icsStamp(iso: string): string {
  return `${iso.slice(0, 19).replace(/[-:]/g, '')}Z`;
}

function toIcs(resourceName: string, events: Array<import('../ade/ics.ts').CourseEvent>): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//EDT ULCO//FR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsEscape(`EDT ${resourceName}`)}`,
  ];
  for (const event of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${icsEscape(event.uid)}`,
      `DTSTAMP:${icsStamp(new Date().toISOString())}`,
      `DTSTART:${icsStamp(event.start)}`,
      `DTEND:${icsStamp(event.end)}`,
      `SUMMARY:${icsEscape(event.title)}`,
      ...(event.room ? [`LOCATION:${icsEscape(event.room)}`] : []),
      `DESCRIPTION:${icsEscape([event.kind, event.groups.join(', '), event.teachers.join(', ')].filter(Boolean).join('\n'))}`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  // RFC 5545 : les lignes se terminent par CRLF.
  return `${lines.join('\r\n')}\r\n`;
}
