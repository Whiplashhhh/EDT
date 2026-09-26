import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { CrousError, CrousService, normalizeDays, prettyName } from '../src/crous/service.ts';

test('prettyName redresse les noms tout en minuscules du Crous', () => {
  assert.equal(prettyName('r.u. de la mi-voix (calais)'), 'R.U. de la Mi-Voix (Calais)');
});

test('normalizeDays ne garde que le service du midi et convertit la date', () => {
  const days = normalizeDays([
    {
      date: '24-09-2026',
      repas: [
        { type: 'soir', categories: [{ libelle: 'Plat', ordre: 1, plats: [{ libelle: 'Soupe', ordre: 1 }] }] },
        {
          type: 'midi',
          categories: [
            { libelle: 'Plat', ordre: 2, plats: [{ libelle: 'Saucisse', ordre: 1 }] },
            { libelle: 'Garniture', ordre: 1, plats: [{ libelle: 'Riz pilaf', ordre: 1 }] },
            // Catégorie décorative : elle n'annonce aucun plat réel.
            { libelle: "Sous reserve d'approvisionnement", ordre: 0, plats: [{ libelle: 'Menu non communiqué', ordre: 1 }] },
          ],
        },
      ],
    },
  ]);

  assert.deepEqual(days, [{
    day: '2026-09-24',
    closed: false,
    categories: [
      { label: 'Garniture', dishes: ['Riz pilaf'] },
      { label: 'Plat', dishes: ['Saucisse'] },
    ],
  }]);
});

test('normalizeDays reconnaît une journée de fermeture', () => {
  const days = normalizeDays([
    {
      date: '22-09-2026',
      repas: [{ type: 'midi', categories: [{ libelle: 'Fermeture', ordre: 1, plats: [{ libelle: 'Structure fermée', ordre: 1 }] }] }],
    },
  ]);
  assert.deepEqual(days, [{ day: '2026-09-22', closed: true, categories: [] }]);
});

/** Un CROUStillant simulé : chaque chemin reçoit sa réponse. */
function serviceWith(routes: Record<string, { status: number; body: unknown }>) {
  const config = { crousApiBase: 'https://crous.test', crousRestaurantId: 1164, crousTtlMs: 60_000 } as any;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    const route = routes[new URL(url).pathname];
    return new Response(JSON.stringify(route.body), { status: route.status });
  }) as typeof fetch;
  return { service: new CrousService(config), restore: () => { globalThis.fetch = realFetch; } };
}

const RESTAURANT = { status: 200, body: { success: true, data: { nom: 'r.u. de la mi-voix (calais)', horaires: ['Service de 11h15 à 13h45'] } } };

test('un menu pas encore publié donne des jours vides, pas une erreur', async () => {
  const { service, restore } = serviceWith({
    '/restaurants/1164': RESTAURANT,
    '/restaurants/1164/menu': { status: 404, body: { success: false, message: "Aucun menu n'est disponible pour ce restaurant." } },
  });
  try {
    const menu = await service.menu();
    assert.deepEqual(menu.days, []);
    assert.equal(menu.restaurant.name, 'R.U. de la Mi-Voix (Calais)');
  } finally {
    restore();
  }
});

test('un restaurant introuvable reste une erreur', async () => {
  const { service, restore } = serviceWith({
    '/restaurants/1164': { status: 404, body: { success: false } },
    '/restaurants/1164/menu': { status: 404, body: { success: false } },
  });
  try {
    await assert.rejects(service.menu(), CrousError);
  } finally {
    restore();
  }
});
