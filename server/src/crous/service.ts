/**
 * Menu du restaurant universitaire, via l'API publique CROUStillant
 * (https://croustillant.menu), qui republie les menus du réseau Crous.
 *
 * Le restaurant est fixé par la configuration : l'application ne propose pas
 * d'en changer, elle n'affiche que celui de l'établissement.
 */
import { TtlCache } from '../cache.ts';
import type { AppConfig } from '../config.ts';

export interface MenuCategory {
  label: string;
  dishes: string[];
}

export interface MenuDay {
  /** `AAAA-MM-JJ`. */
  day: string;
  /** Le Crous publie « Structure fermée » les jours de fermeture. */
  closed: boolean;
  categories: MenuCategory[];
}

export interface CrousMenu {
  restaurant: { id: number; name: string; address: string | null; hours: string[] };
  fetchedAt: string;
  days: MenuDay[];
}

export class CrousError extends Error {}

/** Taille maximale acceptée pour une réponse de l'API (2 Mo). */
const MAX_BYTES = 2 * 1024 * 1024;
/** Catégories sans intérêt pour l'affichage : elles n'annoncent aucun plat réel. */
const NOISE = /^sous reserve|^menu non communiqu/i;

export class CrousService {
  readonly #config: AppConfig;
  readonly #cache: TtlCache<CrousMenu>;

  constructor(config: AppConfig) {
    this.#config = config;
    this.#cache = new TtlCache<CrousMenu>(config.crousTtlMs, 4);
  }

  async menu(): Promise<CrousMenu> {
    const id = this.#config.crousRestaurantId;
    return this.#cache.get(String(id), async () => {
      const [restaurant, menu] = await Promise.all([
        this.#get(`/restaurants/${id}`),
        // Rien de publié n'est pas une panne : les jours restent simplement vides.
        this.#get(`/restaurants/${id}/menu`, { missingOk: true }),
      ]);
      return {
        restaurant: {
          id,
          name: prettyName(String(restaurant.nom ?? 'Restaurant universitaire')),
          address: restaurant.adresse ? String(restaurant.adresse) : null,
          hours: Array.isArray(restaurant.horaires) ? restaurant.horaires.map(String) : [],
        },
        fetchedAt: new Date().toISOString(),
        days: normalizeDays(menu),
      };
    });
  }

  async #get(path: string, opts: { missingOk?: boolean } = {}): Promise<any> {
    const res = await fetch(`${this.#config.crousApiBase}${path}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(12_000),
    });
    // CROUStillant répond 404 tant que le Crous n'a publié aucun menu.
    if (res.status === 404 && opts.missingOk) return [];
    if (!res.ok) throw new CrousError(`CROUStillant a répondu ${res.status}`);
    const declared = Number(res.headers.get('content-length') ?? 0);
    if (declared > MAX_BYTES) throw new CrousError('Réponse CROUStillant trop volumineuse');
    const body = await res.text();
    if (body.length > MAX_BYTES) throw new CrousError('Réponse CROUStillant trop volumineuse');
    const parsed = JSON.parse(body) as { success?: boolean; data?: unknown };
    if (!parsed.success || parsed.data == null) throw new CrousError('Réponse CROUStillant inattendue');
    return parsed.data;
  }
}

/** Le Crous publie ses noms tout en minuscules : « r.u. de la mi-voix (calais) ». */
const LOWERCASE_WORDS = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'aux', 'au', 'et', 'en', 'sur', 'sous']);

export function prettyName(raw: string): string {
  return raw.toLowerCase().replace(/[\p{L}][\p{L}'\u2019.-]*/gu, (word) => {
    // « r.u. » est un sigle : il s'écrit en capitales.
    if (word.includes('.')) return word.toUpperCase();
    if (LOWERCASE_WORDS.has(word)) return word;
    // « mi-voix » → « Mi-Voix » : chaque partie prend sa majuscule.
    return word.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('-');
  });
}

/** `JJ-MM-AAAA` → `AAAA-MM-JJ`. */
function toIsoDay(raw: unknown): string | null {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(String(raw ?? ''));
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

export function normalizeDays(raw: unknown): MenuDay[] {
  if (!Array.isArray(raw)) return [];
  const out: MenuDay[] = [];
  for (const entry of raw) {
    const day = toIsoDay(entry?.date);
    if (!day) continue;
    // Un seul service nous intéresse : le déjeuner.
    const midi = (entry?.repas ?? []).find((r: any) => String(r?.type ?? '').toLowerCase() === 'midi');
    if (!midi) continue;

    const categories: MenuCategory[] = [];
    let closed = false;
    for (const cat of [...(midi.categories ?? [])].sort((a: any, b: any) => (a?.ordre ?? 0) - (b?.ordre ?? 0))) {
      const label = String(cat?.libelle ?? '').trim();
      const dishes = [...(cat?.plats ?? [])]
        .sort((a: any, b: any) => (a?.ordre ?? 0) - (b?.ordre ?? 0))
        .map((p: any) => String(p?.libelle ?? '').trim())
        .filter(Boolean);
      if (/fermeture|ferm[ée]e?/i.test(label) || dishes.some((d) => /structure ferm/i.test(d))) {
        closed = true;
        continue;
      }
      if (!dishes.length || NOISE.test(label)) continue;
      categories.push({ label, dishes });
    }
    out.push({ day, closed, categories });
  }
  return out.sort((a, b) => a.day.localeCompare(b.day));
}
