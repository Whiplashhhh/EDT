/**
 * Cache mémoire à durée de vie, avec « single flight » : deux requêtes
 * simultanées sur la même clé ne déclenchent qu'un seul appel à ADE.
 *
 * Avec `staleMs`, une entrée expirée n'est pas oubliée tout de suite : si son
 * rechargement échoue, on la resert, marquée `stale`, plutôt que l'erreur. On
 * attend ensuite `retryMs` avant de retenter, pour qu'un ADE qui ne répond plus
 * ne fasse pas patienter chaque visiteur jusqu'au délai d'expiration.
 */
export interface CacheOptions {
  /** Combien de temps, après expiration, une entrée peut encore servir de secours. */
  staleMs?: number;
  /** Délai avant de retenter un chargement qui a échoué alors qu'un secours existait. */
  retryMs?: number;
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

  constructor(ttlMs: number, maxEntries = 500, { staleMs = 0, retryMs = 60_000 }: CacheOptions = {}) {
    this.#ttlMs = ttlMs;
    this.#maxEntries = maxEntries;
    this.#staleMs = staleMs;
    this.#retryMs = retryMs;
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
  }

  async get(key: string, load: () => Promise<T>): Promise<T> {
    return (await this.lookup(key, load)).value;
  }

  /** Comme `get`, en disant aussi d'où vient la valeur. */
  async lookup(key: string, load: () => Promise<T>): Promise<Lookup<T>> {
    const hit = this.#entry(key);
    if (hit && hit.expiresAt > Date.now()) return { value: hit.value, storedAt: hit.storedAt, stale: hit.stale };

    const pending = this.#inFlight.get(key);
    if (pending) return pending;

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

    this.#inFlight.set(key, promise);
    return promise;
  }

  clear(): void {
    this.#entries.clear();
  }
}
