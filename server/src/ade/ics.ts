/** Lecture des flux iCalendar produits par ADE et mise en forme « cours ». */

export interface CourseEvent {
  /** Identifiant stable du cours (UID iCalendar). */
  uid: string;
  /** Début / fin en ISO 8601 UTC. */
  start: string;
  end: string;
  /** Intitulé complet tel qu'ADE le publie, ex. « R1-01 Dev TPB ». */
  title: string;
  /** Intitulé sans le suffixe de type, ex. « R1-01 Dev ». */
  subject: string;
  /** CM, TD, TP, DS… ou null si non déductible. */
  kind: string | null;
  room: string | null;
  teachers: string[];
  groups: string[];
}

/** Déplie les lignes iCalendar (RFC 5545 §3.1 : continuation par espace ou tabulation). */
function unfold(text: string): string[] {
  return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}

function unescapeText(value: string): string {
  return value
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\;/g, ';')
    .replace(/\\\\/g, '\\');
}

/** `20261012T110000Z` ou `20261012T130000` (heure locale Paris) → ISO UTC. */
function parseIcsDate(value: string, tzid?: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (z === 'Z') return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s)).toISOString();
  // Sans suffixe Z, ADE publie en heure locale de l'établissement.
  const zone = tzid || 'Europe/Paris';
  const naive = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
  const offset = zoneOffsetMinutes(naive, zone);
  return new Date(naive - offset * 60_000).toISOString();
}

function zoneOffsetMinutes(utcMs: number, timeZone: string): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = Object.fromEntries(fmt.formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  return Math.round((Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - utcMs) / 60_000);
}

/**
 * ADE encode le type de séance dans l'intitulé, le plus souvent en suffixe
 * (« R1-01 Dev TPB », « R1-03 Archi CM ») mais parfois au milieu
 * (« R1-07 ALG TD1 ANALYSE », « R3-08 TPA M DUPONT »). On cherche donc le jeton
 * partout dans l'intitulé, en retenant le dernier. Certains cursus (BUT3) ne
 * publient aucun type : `kind` vaut alors null et l'affichage se rabat sur le module.
 */
// Le jeton doit être isolé : un code de module pointé comme « SAE5.A.00 » n'en est pas un.
const KIND_RE = /(?<![\w.])(CM|TD|TP|DS|CC|EXAM|SAE|PROJET)([A-Z]?\d*)(?![\w.])/gi;

/** Dernière occurrence d'un type de séance dans l'intitulé, ou null. */
function findKind(title: string): { kind: string; start: number; end: number } | null {
  let last: RegExpExecArray | null = null;
  KIND_RE.lastIndex = 0;
  for (let m = KIND_RE.exec(title); m; m = KIND_RE.exec(title)) last = m;
  if (!last) return null;
  return { kind: last[1].toUpperCase(), start: last.index, end: last.index + last[0].length };
}

/** Un intitulé de groupe ADE : majuscules, chiffres et tirets (« BUT1-TD1 »). */
const GROUP_RE = /^[A-Z0-9][A-Z0-9 .\-_]*$/;

/**
 * Convertit un flux ICS ADE en liste de cours.
 * Tolérant : une ligne illisible est ignorée plutôt que de faire échouer le flux.
 */
export function parseAdeIcs(ics: string): CourseEvent[] {
  const events: CourseEvent[] = [];
  let current: Record<string, string> | null = null;

  for (const line of unfold(ics)) {
    if (line === 'BEGIN:VEVENT') { current = {}; continue; }
    if (line === 'END:VEVENT') {
      if (current) {
        const event = toCourse(current);
        if (event) events.push(event);
      }
      current = null;
      continue;
    }
    if (!current) continue;
    const sep = line.indexOf(':');
    if (sep < 0) continue;
    const rawName = line.slice(0, sep);
    const name = rawName.split(';')[0].toUpperCase();
    current[name] = line.slice(sep + 1);
    const tzid = /TZID=([^;:]+)/.exec(rawName)?.[1];
    if (tzid) current[`${name}__TZID`] = tzid;
  }

  events.sort((a, b) => a.start.localeCompare(b.start));
  return events;
}

function toCourse(fields: Record<string, string>): CourseEvent | null {
  const start = fields.DTSTART ? parseIcsDate(fields.DTSTART, fields.DTSTART__TZID) : null;
  const end = fields.DTEND ? parseIcsDate(fields.DTEND, fields.DTEND__TZID) : null;
  if (!start || !end) return null;

  const title = unescapeText(fields.SUMMARY ?? '').trim();
  const room = unescapeText(fields.LOCATION ?? '').trim() || null;

  const lines = unescapeText(fields.DESCRIPTION ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('(Export'));

  const groups: string[] = [];
  const teachers: string[] = [];
  for (const line of lines) {
    if (GROUP_RE.test(line)) groups.push(line);
    else teachers.push(line);
  }

  const found = findKind(title);
  const kind = found ? found.kind : null;
  // L'intitulé « propre » est le titre privé de son jeton de type.
  const subject = found
    ? `${title.slice(0, found.start)} ${title.slice(found.end)}`.replace(/\s+/g, ' ').trim() || title
    : title;

  return {
    uid: fields.UID?.trim() || `${start}-${title}`,
    start,
    end,
    title,
    subject,
    kind,
    room,
    teachers,
    groups,
  };
}
