import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export interface Department {
  id: string;
  label: string;
  origin: string;
  projectId: number;
  token: string;
}

export interface AppConfig {
  host: string;
  port: number;
  /** Origines autorisées à appeler l'API depuis un autre domaine (vide = même origine seulement). */
  allowedOrigins: string[];
  departments: Department[];
  /** Durée de vie du catalogue des groupes (ms). */
  catalogTtlMs: number;
  /** Durée de vie d'un emploi du temps en cache (ms). */
  scheduleTtlMs: number;
}

const ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

function readDepartments(): Department[] {
  const path = fileURLToPath(new URL('../config/departments.json', import.meta.url));
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as { departments?: unknown };
  if (!Array.isArray(parsed.departments)) throw new Error('departments.json : clé "departments" manquante');

  return parsed.departments.map((raw, index) => {
    const d = raw as Partial<Department>;
    if (!d.id || !ID_RE.test(d.id)) throw new Error(`departments.json[${index}] : id invalide`);
    if (!d.label) throw new Error(`departments.json[${index}] : label manquant`);
    const origin = String(d.origin ?? '');
    if (!/^https:\/\/[a-z0-9.-]+$/i.test(origin)) {
      throw new Error(`departments.json[${index}] : origin doit être une URL https sans chemin`);
    }
    // Le jeton peut rester hors du dépôt : ADE_TOKEN_IUT_INFO écrase la valeur du fichier.
    const envKey = `ADE_TOKEN_${d.id.replaceAll('-', '_').toUpperCase()}`;
    const token = process.env[envKey] ?? d.token ?? '';
    if (!/^[0-9a-f]{32,}$/i.test(token)) throw new Error(`departments.json[${index}] : jeton ADE absent ou invalide`);
    const projectId = Number(d.projectId);
    if (!Number.isInteger(projectId) || projectId < 0) throw new Error(`departments.json[${index}] : projectId invalide`);
    return { id: d.id, label: d.label, origin, projectId, token };
  });
}

function positiveInt(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export function loadConfig(): AppConfig {
  return {
    host: process.env.HOST ?? '0.0.0.0',
    port: positiveInt(process.env.PORT, 3000),
    allowedOrigins: (process.env.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    departments: readDepartments(),
    catalogTtlMs: positiveInt(process.env.CATALOG_TTL_MS, 12 * 60 * 60 * 1000),
    scheduleTtlMs: positiveInt(process.env.SCHEDULE_TTL_MS, 10 * 60 * 1000),
  };
}
