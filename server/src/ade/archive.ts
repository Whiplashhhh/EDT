import type { CourseEvent } from './ics.ts';

/**
 * Les semaines révolues, gardées pour de bon. Un cours passé ne change plus :
 * une fois sa semaine terminée et relue dans ADE, on ne la redemande jamais.
 *
 * Une entrée est une semaine entière d'une source — une classe, ou toute une
 * formation pour les vues transversales —, cours compris ou non : une semaine
 * archivée sans cours est une semaine sans cours, pas une semaine inconnue.
 */
export class WeekArchive {
  readonly #weeks = new Map<string, { events: CourseEvent[]; storedAt: number }>();
  #revision = 0;

  static key(source: string, week: string): string {
    return `${source}|${week}`;
  }

  /** Change à chaque semaine archivée : il est alors temps de sauvegarder. */
  get revision(): number {
    return this.#revision;
  }

  get(source: string, week: string): CourseEvent[] | undefined {
    return this.#weeks.get(WeekArchive.key(source, week))?.events;
  }

  set(source: string, week: string, events: CourseEvent[], storedAt = Date.now()): void {
    this.#weeks.set(WeekArchive.key(source, week), { events, storedAt });
    this.#revision += 1;
  }

  /**
   * Oublie les semaines antérieures à `from` (lundi ISO) : celles d'une année
   * universitaire terminée. Le fichier de sauvegarde ne grossit pas d'année en
   * année.
   */
  prune(from: string): void {
    for (const key of [...this.#weeks.keys()]) {
      if (key.slice(key.lastIndexOf('|') + 1) < from) {
        this.#weeks.delete(key);
        this.#revision += 1;
      }
    }
  }

  dump(): Array<[key: string, value: CourseEvent[], storedAt: number]> {
    return [...this.#weeks].map(([key, { events, storedAt }]) => [key, events, storedAt]);
  }

  restore(key: string, value: CourseEvent[], storedAt: number): void {
    if (!Array.isArray(value) || !key.includes('|')) return;
    this.#weeks.set(key, { events: value, storedAt });
  }
}
