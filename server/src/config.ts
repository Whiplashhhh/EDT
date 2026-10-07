import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { AdeRelay } from './ade/gwt.ts';

/** Le lien ADE public qui ouvre l'arbre de tout l'établissement. */
export interface AdeSource {
  origin: string;
  projectId: number;
  token: string;
  /** Relais facultatif vers ADE, quand celui-ci refuse l'adresse du serveur. */
  relay: AdeRelay | null;
}

export interface City {
  id: string;
  label: string;
  /** Reconnaît la ville dans le nom d'une composante (« CGU Calais », « EILCO Saint-Omer »). */
  pattern: RegExp;
  /** Restaurant universitaire le plus proche du campus (identifiant CROUStillant). */
  crous: number | null;
}

/**
 * Rangement des composantes par ville. ADE ne le connaît pas : il se lit dans
 * le nom de la composante, et pour celles dont le nom ne le dit pas — les
 * départements d'IUT —, dans une table tenue à la main.
 */
export interface CampusConfig {
  cities: City[];
  /** Nom ADE de la composante → identifiant de sa ville. */
  composantes: Record<string, string>;
}

/**
 * Notifications push. Sans paire de clés VAPID, la fonctionnalité reste
 * éteinte : le serveur n'expose pas les routes d'abonnement et le front ne
 * propose pas les réglages. `npm run vapid --workspace=server` en fabrique une.
 */
export interface PushConfig {
  enabled: boolean;
  publicKey: string;
  privateKey: string;
  /** Contact de l'exploitant, exigé par VAPID (`mailto:` ou `https:`). */
  subject: string;
  /** Fichier des abonnements — la seule donnée que le service écrive sur disque. */
  storePath: string;
  /** Intervalle du battement qui déclenche les rappels dus. */
  tickMs: number;
  /** Âge maximal d'un emploi du temps avant de le redemander à ADE. */
  pollMs: number;
}

/**
 * Formulaire de contact. Les messages partent par SMTP authentifié chez un
 * service d'envoi ; sans destinataire ni serveur SMTP, le formulaire reste
 * caché. L'adresse de destination ne quitte jamais le serveur.
 */
export interface FeedbackConfig {
  enabled: boolean;
  /** Boîte de l'exploitant, qui reçoit les messages. */
  to: string;
  /** Expéditeur, sur un domaine authentifié chez le service d'envoi. */
  from: string;
  smtp: { host: string; port: number; secure: boolean; user: string; pass: string };
}

export interface AppConfig {
  host: string;
  port: number;
  /** Origines autorisées à appeler l'API depuis un autre domaine (vide = même origine seulement). */
  allowedOrigins: string[];
  ade: AdeSource;
  campus: CampusConfig;
  /** Durée de vie du catalogue des groupes (ms). */
  catalogTtlMs: number;
  /** Durée de vie d'un emploi du temps en cache (ms). */
  scheduleTtlMs: number;
  /**
   * Durée de vie des cours de toute une formation, ou de toute l'ULCO, réunis
   * pour les vues par salle, enseignant ou ressource (ms).
   */
  aggregateTtlMs: number;
  /** Fichier où les données d'ADE survivent à un redémarrage. */
  adeCachePath: string;
  /** Base de l'API publique qui republie les menus Crous. */
  crousApiBase: string;
  /**
   * Restaurant universitaire par défaut (identifiant CROUStillant) : celui d'une
   * formation dont la ville n'a pas de restaurant dans `ade.json`. Les autres
   * suivent leur campus ; le client ne choisit jamais un restaurant lui-même.
   */
  crousRestaurantId: number;
  /** Durée de vie du menu en cache (ms). Le Crous publie une fois par jour. */
  crousTtlMs: number;
  push: PushConfig;
  feedback: FeedbackConfig;
}

const ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

interface AdeFile {
  origin?: unknown;
  projectId?: unknown;
  token?: unknown;
  cities?: Array<{ id?: unknown; label?: unknown; pattern?: unknown; crous?: unknown }>;
  composantes?: Record<string, unknown>;
}

function readAdeFile(): AdeFile {
  const path = fileURLToPath(new URL('../config/ade.json', import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as AdeFile;
}

function readSource(file: AdeFile): AdeSource {
  const origin = String(file.origin ?? '');
  if (!/^https:\/\/[a-z0-9.-]+$/i.test(origin)) throw new Error('ade.json : origin doit être une URL https sans chemin');
  // Le jeton reste hors du dépôt : la variable d'environnement a la priorité.
  const token = process.env.ADE_TOKEN ?? String(file.token ?? '');
  if (!/^[0-9a-f]{32,}$/i.test(token)) throw new Error('ADE_TOKEN absent ou invalide (paramètre `data=` du lien ADE public)');
  const projectId = Number(file.projectId);
  if (!Number.isInteger(projectId) || projectId < 0) throw new Error('ade.json : projectId invalide');
  return { origin, projectId, token, relay: readRelay() };
}

/** Le relais va avec sa clé : l'un sans l'autre arrête le démarrage. */
function readRelay(): AdeRelay | null {
  const url = (process.env.ADE_RELAY_URL ?? '').replace(/\/+$/, '');
  const key = process.env.ADE_RELAY_KEY ?? '';
  if (!url && !key) return null;
  if (!/^https:\/\/[a-z0-9.-]+$/i.test(url)) throw new Error('ADE_RELAY_URL doit être une URL https sans chemin');
  if (key.length < 32) throw new Error('ADE_RELAY_KEY doit compter au moins 32 caractères');
  return { url, key };
}

function readCampus(file: AdeFile): CampusConfig {
  if (!Array.isArray(file.cities) || file.cities.length === 0) throw new Error('ade.json : clé "cities" manquante');
  const cities = file.cities.map((raw, index) => {
    const id = String(raw.id ?? '');
    if (!ID_RE.test(id)) throw new Error(`ade.json : cities[${index}].id invalide`);
    if (!raw.label) throw new Error(`ade.json : cities[${index}].label manquant`);
    const crous = raw.crous === undefined ? null : Number(raw.crous);
    if (crous !== null && (!Number.isInteger(crous) || crous <= 0)) throw new Error(`ade.json : cities[${index}].crous invalide`);
    return { id, label: String(raw.label), pattern: new RegExp(String(raw.pattern ?? id), 'i'), crous };
  });
  const composantes: Record<string, string> = {};
  for (const [name, city] of Object.entries(file.composantes ?? {})) {
    if (!cities.some((c) => c.id === city)) throw new Error(`ade.json : ville inconnue pour « ${name} »`);
    composantes[name] = String(city);
  }
  return { cities, composantes };
}

/**
 * Lecture des réglages de notification.
 *
 * Les deux clés doivent être présentes ensemble : une seule ne permet rien, et
 * démarrer « à moitié activé » ne ferait qu'échouer plus tard, à l'envoi.
 */
function readPushConfig(): PushConfig {
  const publicKey = process.env.VAPID_PUBLIC_KEY ?? '';
  const privateKey = process.env.VAPID_PRIVATE_KEY ?? '';
  const subject = process.env.VAPID_SUBJECT ?? '';
  const enabled = Boolean(publicKey && privateKey);

  if (enabled && !/^(mailto:|https:\/\/)/.test(subject)) {
    throw new Error('VAPID_SUBJECT doit être une adresse `mailto:` ou une URL `https:`');
  }
  if (Boolean(publicKey) !== Boolean(privateKey)) {
    throw new Error('VAPID_PUBLIC_KEY et VAPID_PRIVATE_KEY vont par paire');
  }

  return {
    enabled,
    publicKey,
    privateKey,
    subject,
    storePath:
      process.env.PUSH_STORE_PATH ?? fileURLToPath(new URL('../data/subscriptions.json', import.meta.url)),
    tickMs: positiveInt(process.env.PUSH_TICK_MS, 60 * 1000),
    pollMs: positiveInt(process.env.PUSH_POLL_MS, 5 * 60 * 1000),
  };
}

/**
 * Lecture des réglages du formulaire de contact. Une configuration à moitié
 * faite arrête le démarrage, comme pour VAPID : mieux vaut le savoir tout de
 * suite qu'au premier message perdu.
 */
function readFeedbackConfig(): FeedbackConfig {
  const to = process.env.FEEDBACK_TO ?? '';
  const from = process.env.FEEDBACK_FROM ?? '';
  const host = process.env.SMTP_HOST ?? '';
  const port = positiveInt(process.env.SMTP_PORT, 465);
  const enabled = Boolean(to && from && host);

  if (!enabled && (to || from || host)) {
    throw new Error('Formulaire de contact : FEEDBACK_TO, FEEDBACK_FROM et SMTP_HOST vont ensemble');
  }

  return {
    enabled,
    to,
    from,
    smtp: {
      host,
      port,
      // 465 : TLS d'emblée ; 587 : STARTTLS, négocié par nodemailer.
      secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465,
      user: process.env.SMTP_USER ?? '',
      pass: process.env.SMTP_PASS ?? '',
    },
  };
}

function positiveInt(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export function loadConfig(): AppConfig {
  const adeFile = readAdeFile();
  return {
    host: process.env.HOST ?? '0.0.0.0',
    port: positiveInt(process.env.PORT, 3000),
    allowedOrigins: (process.env.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    ade: readSource(adeFile),
    campus: readCampus(adeFile),
    catalogTtlMs: positiveInt(process.env.CATALOG_TTL_MS, 12 * 60 * 60 * 1000),
    scheduleTtlMs: positiveInt(process.env.SCHEDULE_TTL_MS, 10 * 60 * 1000),
    aggregateTtlMs: positiveInt(process.env.AGGREGATE_TTL_MS, 30 * 60 * 1000),
    adeCachePath: process.env.ADE_CACHE_PATH ?? fileURLToPath(new URL('../data/ade-cache.json', import.meta.url)),
    crousApiBase: (process.env.CROUS_API_BASE ?? 'https://api.croustillant.menu/v1').replace(/\/+$/, ''),
    // 1164 = R.U. de la Mi-Voix, le restaurant du campus de Calais.
    crousRestaurantId: positiveInt(process.env.CROUS_RESTAURANT_ID, 1164),
    crousTtlMs: positiveInt(process.env.CROUS_TTL_MS, 60 * 60 * 1000),
    push: readPushConfig(),
    feedback: readFeedbackConfig(),
  };
}
