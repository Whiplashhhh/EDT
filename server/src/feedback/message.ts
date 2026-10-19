/**
 * Mise en forme d'un message envoyé depuis l'application : contact, suggestion
 * ou signalement de problème.
 *
 * Tout ce qui arrive ici vient d'un formulaire anonyme : chaque champ est
 * vérifié, borné et débarrassé des caractères de contrôle avant de devenir un
 * courriel. Le courriel est en texte brut — rien n'y est interprété.
 */

export const FEEDBACK_KINDS = ['contact', 'suggestion', 'bug'] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

export const STATUSES = ['student', 'teacher', 'staff', 'other'] as const;
export type Status = (typeof STATUSES)[number];

export const MAX_SUBJECT = 120;
export const MAX_MESSAGE = 4000;
const MAX_NAME = 80;
const MAX_EMAIL = 254;
const MAX_CONTEXT = 200;

/** Pièces jointes : quelques captures d'écran ou un PDF, pas de quoi remplir une boîte aux lettres. */
export const MAX_ATTACHMENTS = 3;
export const MAX_ATTACHMENTS_BYTES = 10 * 1024 * 1024;
/** Taille maximale d'une requête avec pièces jointes : le base64 gonfle de un tiers, le reste est du texte. */
export const MAX_BODY_BYTES = Math.ceil((MAX_ATTACHMENTS_BYTES * 4) / 3) + 64 * 1024;
const MAX_FILENAME = 100;

/** Ce qui figure dans l'objet du courriel, entre crochets. */
const KIND_TAGS: Record<FeedbackKind, string> = {
  contact: 'contact',
  suggestion: 'suggestion',
  bug: 'problème',
};

const STATUS_LABELS: Record<Status, string> = {
  student: 'Étudiant',
  teacher: 'Enseignant',
  staff: 'Personnel',
  other: 'Autre',
};

/** Forme volontairement simple : on veut écarter les erreurs de frappe, pas valider la RFC 5322. */
const EMAIL_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]{2,}$/;
const DEPARTMENT_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const RESOURCE_KINDS = ['groups', 'rooms', 'teachers', 'subjects'];

export interface FeedbackBody {
  kind?: unknown;
  subject?: unknown;
  message?: unknown;
  email?: unknown;
  status?: unknown;
  name?: unknown;
  context?: unknown;
  /** `[{ name, data }]`, `data` étant le contenu du fichier en base64. */
  attachments?: unknown;
  /** Champ piège, invisible pour un humain : un robot qui remplit tout le renseigne. */
  website?: unknown;
}

/** Ce que l'application joint d'elle-même, si on la laisse faire. */
export interface FeedbackContext {
  department: string | null;
  identity: string | null;
  identityKind: string | null;
  viewing: string | null;
  lang: string | null;
  installed: boolean | null;
  userAgent: string | null;
  screen: string | null;
}

export interface Feedback {
  kind: FeedbackKind;
  subject: string;
  message: string;
  email: string | null;
  status: Status | null;
  name: string | null;
  context: FeedbackContext | null;
  attachments: Attachment[];
}

export interface Attachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

function bad(message: string, code = 'generic', statusCode = 400): Error {
  return Object.assign(new Error(message), { statusCode, code });
}

/** Une ligne : sans retour à la ligne ni caractère de contrôle, espaces resserrés. */
function oneLine(raw: unknown, max: number): string {
  if (raw === undefined || raw === null) return '';
  if (typeof raw !== 'string') throw bad('Champ invalide.');
  // eslint-disable-next-line no-control-regex
  const text = raw.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (text.length > max) throw bad('Champ trop long.');
  return text;
}

/** Un texte libre : les retours à la ligne restent, les autres caractères de contrôle partent. */
function multiLine(raw: unknown, max: number): string {
  if (typeof raw !== 'string') throw bad('Message manquant.');
  const text = raw
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]+/g, '')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
  if (text.length > max) throw bad('Message trop long.');
  return text;
}

/** Un renseignement facultatif du contexte : trop long ou mal formé, il est simplement omis. */
function optionalText(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  try {
    return oneLine(raw, MAX_CONTEXT) || null;
  } catch {
    return null;
  }
}

function parseContext(raw: unknown): FeedbackContext | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  return {
    department: typeof c.department === 'string' && DEPARTMENT_RE.test(c.department) ? c.department : null,
    identity: optionalText(c.identity),
    identityKind: typeof c.identityKind === 'string' && RESOURCE_KINDS.includes(c.identityKind) ? c.identityKind : null,
    viewing: optionalText(c.viewing),
    lang: optionalText(c.lang),
    installed: typeof c.installed === 'boolean' ? c.installed : null,
    userAgent: optionalText(c.userAgent),
    screen: optionalText(c.screen),
  };
}

/**
 * Ce que le fichier est vraiment, d'après ses premiers octets : le nom et le
 * type annoncés par le client ne prouvent rien. Seuls les formats qu'un
 * lecteur de courriel affiche sans exécuter quoi que ce soit sont admis.
 */
function sniff(bytes: Buffer): { contentType: string; extension: string } | null {
  const starts = (magic: number[], offset = 0) => magic.every((b, i) => bytes[offset + i] === b);
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { contentType: 'image/png', extension: 'png' };
  if (starts([0xff, 0xd8, 0xff])) return { contentType: 'image/jpeg', extension: 'jpg' };
  if (starts([0x47, 0x49, 0x46, 0x38]) && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61) {
    return { contentType: 'image/gif', extension: 'gif' };
  }
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) {
    return { contentType: 'image/webp', extension: 'webp' };
  }
  if (starts([0x25, 0x50, 0x44, 0x46, 0x2d])) return { contentType: 'application/pdf', extension: 'pdf' };
  return null;
}

/** Nom d'affichage : sans chemin ni caractère de contrôle, et toujours terminé par la vraie extension. */
function safeFilename(raw: unknown, extension: string, index: number): string {
  const base = typeof raw === 'string' ? raw.split(/[\\/]/).pop() ?? '' : '';
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029"<>:*?|]+/g, ' ').replace(/\s+/g, ' ').trim();
  const stem = cleaned.replace(/\.[^.]*$/, '').replace(/^\.+/, '').trim().slice(0, MAX_FILENAME);
  return `${stem || `piece-jointe-${index + 1}`}.${extension}`;
}

function parseAttachments(raw: unknown): Attachment[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw bad('Pièces jointes invalides.', 'feedback-attachment');
  if (raw.length > MAX_ATTACHMENTS) throw bad('Trop de pièces jointes.', 'feedback-attachment');

  let total = 0;
  return raw.map((item, index) => {
    const data = (item as { data?: unknown } | null)?.data;
    if (typeof data !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
      throw bad('Pièce jointe illisible.', 'feedback-attachment');
    }
    const content = Buffer.from(data, 'base64');
    total += content.length;
    if (total > MAX_ATTACHMENTS_BYTES) throw bad('Pièces jointes trop volumineuses.', 'feedback-too-large', 413);
    const kind = sniff(content);
    if (!kind) throw bad('Format de pièce jointe non accepté.', 'feedback-attachment');
    return {
      filename: safeFilename((item as { name?: unknown }).name, kind.extension, index),
      content,
      contentType: kind.contentType,
    };
  });
}

/** Vérifie le formulaire. Lève une erreur 400 si le message est inutilisable. */
export function parseFeedback(body: FeedbackBody): Feedback {
  if (!(FEEDBACK_KINDS as readonly unknown[]).includes(body.kind)) throw bad('Type de message inconnu.');

  const message = multiLine(body.message, MAX_MESSAGE);
  if (message.length < 3) throw bad('Message manquant.');

  const email = oneLine(body.email, MAX_EMAIL) || null;
  if (email && !EMAIL_RE.test(email)) throw bad('Adresse e-mail invalide.', 'feedback-email');

  return {
    kind: body.kind as FeedbackKind,
    subject: oneLine(body.subject, MAX_SUBJECT),
    message,
    email,
    status: (STATUSES as readonly unknown[]).includes(body.status) ? (body.status as Status) : null,
    name: oneLine(body.name, MAX_NAME) || null,
    context: parseContext(body.context),
    attachments: parseAttachments(body.attachments),
  };
}

/** Vrai si le champ piège est rempli : la requête vient d'un robot. */
export function isBot(body: FeedbackBody): boolean {
  return typeof body.website === 'string' && body.website.trim() !== '';
}

/** Objet du courriel : `[EDT - suggestion] Mode sombre`. Sans objet saisi, le début du message. */
export function subjectLine(feedback: Feedback): string {
  let title = feedback.subject;
  if (!title) {
    const first = feedback.message.replace(/\s+/g, ' ');
    title = first.length > 60 ? `${first.slice(0, 60).trimEnd()}…` : first;
  }
  return `[EDT - ${KIND_TAGS[feedback.kind]}] ${title}`;
}

/** Ce que le serveur sait de la formation, que le client ne fait que désigner. */
export interface DepartmentInfo {
  label: string;
  city: string | null;
}

const IDENTITY_KINDS: Record<string, string> = {
  groups: 'classe',
  rooms: 'salle',
  teachers: 'enseignant',
  subjects: 'ressources',
};

function formatSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} Ko` : `${(bytes / 1024 / 1024).toFixed(1)} Mo`;
}

/** Corps du courriel, en texte brut. */
export function bodyText(feedback: Feedback, department: DepartmentInfo | null, sentAt: Date): string {
  const lines: string[] = [];
  const row = (label: string, value: string | null | undefined) => {
    if (value) lines.push(`${label} : ${value}`);
  };

  row('Type', KIND_TAGS[feedback.kind]);
  row('Statut', feedback.status ? STATUS_LABELS[feedback.status] : null);
  row('Nom', feedback.name);
  lines.push(`Répondre à : ${feedback.email ?? 'non communiqué (aucune réponse possible)'}`);
  lines.push('', feedback.message, '', '---');

  const c = feedback.context;
  if (!c) {
    lines.push('Informations techniques non jointes.');
  } else {
    row('Formation', department ? [department.label, department.city].filter(Boolean).join(' — ') : c.department);
    if (c.identity) row(`Emploi du temps (${IDENTITY_KINDS[c.identityKind ?? ''] ?? 'identité'})`, c.identity);
    if (c.viewing && c.viewing !== c.identity) row('Affiché au moment de l’envoi', c.viewing);
    row('Langue', c.lang);
    if (c.installed !== null) row('Application installée', c.installed ? 'oui' : 'non');
    row('Écran', c.screen);
    row('Navigateur', c.userAgent);
  }
  if (feedback.attachments.length > 0) {
    row('Pièces jointes', feedback.attachments.map((a) => `${a.filename} (${formatSize(a.content.length)})`).join(', '));
  }
  row(
    'Envoyé le',
    new Intl.DateTimeFormat('fr-FR', { dateStyle: 'full', timeStyle: 'short', timeZone: 'Europe/Paris' }).format(sentAt),
  );
  return lines.join('\n');
}
