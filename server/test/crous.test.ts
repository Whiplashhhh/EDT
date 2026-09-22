import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { normalizeDays, prettyName } from '../src/crous/service.ts';

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
