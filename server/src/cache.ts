/**
 * Cache mémoire à durée de vie, avec « single flight » : deux requêtes
 * simultanées sur la même clé ne déclenchent qu'un seul appel à ADE.
 */
export class TtlCache<T> {
  readonly #entries = new Map<string, { value: T; expiresAt: number }>();
  readonly #inFlight = new Map<string, Promise<T>>();
  readonly #ttlMs: number;
  readonly #maxEntries: number;

  constructor(ttlMs: number, maxEntries = 500) {
    this.#ttlMs = ttlMs;
    this.#maxEntries = maxEntries;
  }

  peek(key: string): T | undefined {
    const hit = this.#entries.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt <= Date.now()) {
      this.#entries.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: T): void {
    if (this.#entries.size >= this.#maxEntries) {
      // Éviction FIFO : suffisant ici, le cache reste petit.
      const oldest = this.#entries.keys().next();
      if (!oldest.done) this.#entries.delete(oldest.value);
    }
    this.#entries.set(key, { value, expiresAt: Date.now() + this.#ttlMs });
  }

  async get(key: string, load: () => Promise<T>): Promise<T> {
    const cached = this.peek(key);
    if (cached !== undefined) return cached;

    const pending = this.#inFlight.get(key);
    if (pending) return pending;

    const promise = load()
      .then((value) => {
        this.set(key, value);
        return value;
      })
      .finally(() => this.#inFlight.delete(key));

    this.#inFlight.set(key, promise);
    return promise;
  }

  clear(): void {
    this.#entries.clear();
  }
}
