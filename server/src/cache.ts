/**
 * Cache mémoire à durée de vie, avec « single flight » : deux requêtes
 * simultanées sur la même clé ne déclenchent qu'un seul appel à ADE.
 *
 * Avec `staleMs`, une entrée expirée n'est pas oubliée tout de suite : si son
 * rechargement échoue, on la resert, marquée `stale`, plutôt que l'erreur. On
 * attend ensuite `retryMs` avant de retenter, pour qu'un ADE qui ne répond plus
 * ne fasse pas patienter chaque visiteur jusqu'au délai d'expiration.
 *
 * Avec `patienceMs`, on n'attend même pas l'échec : si le rechargement d'une
 * entrée qui a un secours tarde au-delà, on sert le secours tout de suite et le
 * rechargement se poursuit en arrière-plan pour les visiteurs suivants.
 */
export interface CacheOptions {
  /** Combien de temps, après expiration, une entrée peut encore servir de secours. */
  staleMs?: number;
  /** Délai avant de retenter un chargement qui a échoué alors qu'un secours existait. */
  retryMs?: number;
  /** Attente maximale d'un rechargement quand un secours existe ; au-delà, on sert le secours. */
  patienceMs?: number;
}

export interface Lookup<T> {
  value: T;
  /** Date (ms) du chargement réussi dont vient la valeur. */
  storedAt: number;
  /** `true` si la valeur est un secours, faute d'avoir pu la recharger. */
  stale: boolean;
}

interface Entry<T> extends Lookup<T> {
  expiresAt: number;
}

export class TtlCache<T> {
  readonly #entries = new Map<string, Entry<T>>();
  readonly #inFlight = new Map<string, Promise<Lookup<T>>>();
  readonly #ttlMs: number;
  readonly #maxEntries: number;
  readonly #staleMs: number;
  readonly #retryMs: number;
  readonly #patienceMs: number;
  /** Compte les écritures : dit à qui sauvegarde le cache s'il a changé depuis. */
  #revision = 0;

  constructor(
    ttlMs: number,
    maxEntries = 500,
    { staleMs = 0, retryMs = 60_000, patienceMs = Infinity }: CacheOptions = {},
  ) {
    this.#ttlMs = ttlMs;
    this.#maxEntries = maxEntries;
    this.#staleMs = staleMs;
    this.#retryMs = retryMs;
    this.#patienceMs = patienceMs;
  }

  /** Entrée encore utilisable, fraîche ou de secours ; les trop vieilles sont oubliées. */
  #entry(key: string): Entry<T> | undefined {
    const hit = this.#entries.get(key);
    if (hit && hit.storedAt + this.#ttlMs + this.#staleMs <= Date.now()) {
      this.#entries.delete(key);
      return undefined;
    }
    return hit;
  }

  /** Une entrée existe, fraîche ou de secours. */
  has(key: string): boolean {
    return this.#entry(key) !== undefined;
  }

  peek(key: string): T | undefined {
    const hit = this.#entry(key);
    return hit && hit.expiresAt > Date.now() ? hit.value : undefined;
  }

  set(key: string, value: T): void {
    if (!this.#entries.has(key) && this.#entries.size >= this.#maxEntries) {
      // Éviction FIFO : suffisant ici, le cache reste petit.
      const oldest = this.#entries.keys().next();
      if (!oldest.done) this.#entries.delete(oldest.value);
    }
    const now = Date.now();
    this.#entries.set(key, { value, storedAt: now, expiresAt: now + this.#ttlMs, stale: false });
    this.#revision += 1;
  }

  get revision(): number {
    return this.#revision;
  }

  /** Les entrées encore utilisables, avec la date de leur chargement, pour les écrire sur disque. */
  dump(): Array<[key: string, value: T, storedAt: number]> {
    return [...this.#entries.keys()].flatMap((key) => {
      const hit = this.#entry(key);
      return hit ? [[key, hit.value, hit.storedAt] as [string, T, number]] : [];
    });
  }

  /**
   * Reprend une entrée lue sur disque, avec sa date d'origine : selon son âge,
   * elle est encore fraîche, ne sert plus que de secours, ou est ignorée.
   */
  restore(key: string, value: T, storedAt: number): void {
    if (storedAt + this.#ttlMs + this.#staleMs <= Date.now()) return;
    if (!this.#entries.has(key) && this.#entries.size >= this.#maxEntries) return;
    this.#entries.set(key, { value, storedAt, expiresAt: storedAt + this.#ttlMs, stale: false });
  }

  async get(key: string, load: () => Promise<T>): Promise<T> {
    return (await this.lookup(key, load)).value;
  }

  /** Comme `get`, en disant aussi d'où vient la valeur. */
  async lookup(key: string, load: () => Promise<T>): Promise<Lookup<T>> {
    const hit = this.#entry(key);
    if (hit && hit.expiresAt > Date.now()) return { value: hit.value, storedAt: hit.storedAt, stale: hit.stale };

    const promise = this.#inFlight.get(key) ?? this.#load(key, load);
    if (!hit || !Number.isFinite(this.#patienceMs)) return promise;

    // Un secours existe : on ne fait pas attendre le visiteur au-delà de `patienceMs`.
    const fallback: Lookup<T> = { value: hit.value, storedAt: hit.storedAt, stale: true };
    let timer: NodeJS.Timeout | undefined;
    const impatient = new Promise<Lookup<T>>((resolve) => {
      timer = setTimeout(() => resolve(fallback), this.#patienceMs);
      timer.unref?.();
    });
    return Promise.race([promise, impatient]).finally(() => clearTimeout(timer));
  }

  #load(key: string, load: () => Promise<T>): Promise<Lookup<T>> {
    const promise = load()
      .then((value) => {
        this.set(key, value);
        return { value, storedAt: this.#entries.get(key)!.storedAt, stale: false };
      })
      .catch((err: unknown) => {
        const fallback = this.#entry(key);
        if (!fallback) throw err;
        fallback.stale = true;
        fallback.expiresAt = Date.now() + this.#retryMs;
        return { value: fallback.value, storedAt: fallback.storedAt, stale: true };
      })
      .finally(() => this.#inFlight.delete(key));
    // Servi par `patienceMs`, le visiteur n'attend plus ce chargement : son échec ne doit pas remonter.
    promise.catch(() => {});

    this.#inFlight.set(key, promise);
    return promise;
  }

  clear(): void {
    this.#entries.clear();
  }
}
