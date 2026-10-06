import { mkdirSync, readFileSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { CacheSnapshot } from './service.ts';

/**
 * Les données d'ADE sur disque. Ce n'est qu'une copie de secours : un fichier
 * absent ou illisible ne fait que repartir d'un cache vide.
 */
const VERSION = 1;

export function readSnapshot(path: string): CacheSnapshot {
  try {
    const file = JSON.parse(readFileSync(path, 'utf8')) as { version?: number; caches?: CacheSnapshot };
    return file.version === VERSION && file.caches ? file.caches : {};
  } catch {
    return {};
  }
}

/** Écrit à côté puis renomme : un arrêt en pleine écriture ne laisse jamais un fichier tronqué. */
export async function writeSnapshot(path: string, caches: CacheSnapshot): Promise<void> {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify({ version: VERSION, savedAt: new Date().toISOString(), caches }));
  await rename(tmp, path);
}
