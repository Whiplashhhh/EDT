/**
 * Aperçu d'un lien partagé. WhatsApp, Messenger, Discord… ne lancent pas la
 * page : ils lisent les balises `og:` de la page reçue pour dessiner la carte
 * sous le lien. Pour une semaine ou une journée partagée en lecture seule
 * (`?edt=…&semaine=…` ou `&jour=…`, voir `web/src/share.js`), on y met le nom
 * de la classe et la période plutôt que la présentation générale du site.
 */
import { isResourceKind, type AdeService, type ResourceKind } from '../ade/service.ts';
import { parseSelection } from '../ade/subjects.ts';

const DEPARTMENT_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const ID_RE = /^\d{1,12}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const ALL_DEPARTMENTS = 'all';
const PERIOD_PARAMS = { week: 'semaine', day: 'jour' } as const;

export interface SharedPage {
  department: string;
  kind: ResourceKind;
  /** Un identifiant, ou pour les ressources la sélection (`12,34-0`). */
  resourceId: number | string;
  period: 'week' | 'day';
  /** Le lundi de la semaine, ou le jour partagé. */
  day: string;
}

/** Lundi de la semaine qui contient `day` (`AAAA-MM-JJ`). */
function mondayOf(day: string): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}

/**
 * Lit l'adresse d'une page en lecture seule, avec les mêmes règles que le
 * front. `null` pour toute autre adresse : elle garde l'aperçu général.
 */
export function readSharedPage(query: Record<string, unknown>): SharedPage | null {
  const period = (Object.keys(PERIOD_PARAMS) as Array<keyof typeof PERIOD_PARAMS>)
    .find((key) => typeof query[PERIOD_PARAMS[key]] === 'string');
  const raw = typeof query.edt === 'string' ? query.edt : null;
  if (!period || !raw) return null;
  const day = query[PERIOD_PARAMS[period]] as string;
  if (!DAY_RE.test(day) || Number.isNaN(Date.parse(`${day}T12:00:00Z`))) return null;

  const [department, kind, id, ...rest] = raw.split('/');
  if (rest.length || !DEPARTMENT_RE.test(department ?? '') || !kind || !isResourceKind(kind)) return null;
  // Une classe appartient à sa formation ; le reste se consulte toutes formations réunies.
  if ((kind === 'groups') === (department === ALL_DEPARTMENTS)) return null;
  let resourceId: number | string;
  if (kind === 'subjects') {
    if (!id || !parseSelection(id)) return null;
    resourceId = id;
  } else {
    if (!ID_RE.test(id ?? '')) return null;
    resourceId = Number(id);
  }
  return { department, kind, resourceId, period, day: period === 'week' ? mondayOf(day) : day };
}

const longDay = new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' });
const dayMonth = new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', day: 'numeric', month: 'long' });
const at = (day: string) => new Date(`${day}T12:00:00Z`);
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Titre et description de la carte. L'aperçu est en français, comme le reste
 * des balises de la page : le lien ne dit pas la langue du destinataire.
 */
export function previewText(
  page: SharedPage,
  { name, departmentLabel }: { name: string | null; departmentLabel?: string | null },
): { title: string; description: string } {
  const period = page.period === 'week'
    ? `Semaine du ${dayMonth.format(at(page.day))}`
    : capitalize(longDay.format(at(page.day)));
  const what = page.period === 'week'
    ? `Les cours de la semaine du ${longDay.format(at(page.day))}`
    : `Les cours du ${longDay.format(at(page.day))}`;
  return {
    title: name ? `${name} · ${period}` : `Emploi du temps · ${period}`,
    description: [departmentLabel, `${what}, tenus à jour depuis ADE.`].filter(Boolean).join(' — '),
  };
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Remplace la valeur d'une balise `<meta … content="…">` repérée par son attribut. */
function setMeta(html: string, attr: string, key: string, value: string): string {
  const re = new RegExp(`(<meta ${attr}="${key}" content=")[^"]*(")`);
  return html.replace(re, (_m, open: string, close: string) => `${open}${escapeAttr(value)}${close}`);
}

/**
 * La page d'accueil, avec l'aperçu du lien à la place de la présentation
 * générale. `path` est l'adresse demandée (`/?edt=…`) : l'`og:url` y renvoie,
 * sur le domaine déjà inscrit dans la page.
 */
export function injectPreview(html: string, { title, description, path }: { title: string; description: string; path: string }): string {
  const origin = /<meta property="og:url" content="(https?:\/\/[^/"]+)/.exec(html)?.[1];
  let out = html.replace(/<title>[^<]*<\/title>/, () => `<title>${escapeAttr(title)}</title>`);
  out = setMeta(out, 'property', 'og:title', title);
  out = setMeta(out, 'property', 'og:description', description);
  out = setMeta(out, 'name', 'description', description);
  if (origin) out = setMeta(out, 'property', 'og:url', `${origin}${path}`);
  return out;
}

/**
 * Nom de ce que le lien montre, et pour une classe le nom de sa formation —
 * les mêmes recherches que fait la page en s'ouvrant, donc rien de plus à
 * demander à ADE.
 */
export async function describeShared(
  service: AdeService,
  page: SharedPage,
  from: string,
): Promise<{ name: string | null; departmentLabel: string | null }> {
  if (page.kind === 'groups') {
    const [group, { departments }] = await Promise.all([
      service.findGroup(page.department, page.resourceId as number),
      service.departments(),
    ]);
    return { name: group.name, departmentLabel: departments.find((d) => d.id === page.department)?.label ?? null };
  }
  const { entries } = await service.directory(ALL_DEPARTMENTS, page.kind, from);
  if (page.kind === 'subjects') {
    const ids = new Set((parseSelection(String(page.resourceId)) ?? []).map((pick) => pick.id));
    const list = entries.filter((e) => ids.has(e.id));
    // Une ressource seule se nomme en entier ; plusieurs, par leurs seuls codes.
    const name = list.length === 1 ? [list[0].name, list[0].label].filter(Boolean).join(' ') : list.map((e) => e.name).join(', ');
    return { name: name || null, departmentLabel: null };
  }
  return { name: entries.find((e) => e.id === page.resourceId)?.name ?? null, departmentLabel: null };
}
