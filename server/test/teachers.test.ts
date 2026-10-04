import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseAdeIcs } from '../src/ade/ics.ts';
import { personOf, readTeachers, teacherAliases } from '../src/ade/teachers.ts';

// Exemples relevés dans les descriptions ADE de l'ULCO.

test('un nom au format d’ADE reste tel quel', () => {
  for (const name of ['LETREZ Séverine', 'LE LOC\'H François', 'VAN MARCKE DE LUMMEN Jimmy', 'WATTEZ Jean-Philippe', 'BRISENO VALDEZ Ernesto Ivan']) {
    assert.deepEqual(readTeachers(name), { teachers: [name], note: null });
  }
});

test('les autres écritures d’un nom se ramènent au format d’ADE', () => {
  assert.equal(personOf('- Line PERON -'), 'PERON Line');
  assert.equal(personOf('Mme Laura BALLOY'), 'BALLOY Laura');
  assert.equal(personOf('MME REANT Karine'), 'REANT Karine');
  assert.equal(personOf('BOUREL Christophe (titulaire)'), 'BOUREL Christophe');
  assert.equal(personOf('BEN CHIKH\tMalak'.replace('\t', ' ')), 'BEN CHIKH Malak');
  assert.equal(personOf('S.Boivin'), 'BOIVIN S.');
  assert.equal(personOf('F. LARUELLE'), 'LARUELLE F.');
  assert.equal(personOf('M. Basse'), 'BASSE');
  assert.equal(personOf('Enseignant : Mr Toukoussala'), 'TOUKOUSSALA');
  assert.equal(personOf('Séance assurée par Antoine Marsac'), 'MARSAC Antoine');
  assert.equal(personOf('+ Alexis Porcher'), 'PORCHER Alexis');
  // « MR » en tête d'un nom n'est pas une civilité.
  assert.equal(personOf('MRIZAK Sana'), 'MRIZAK Sana');
});

test('une ligne peut citer plusieurs intervenants, suivis d’une précision', () => {
  assert.deepEqual(readTeachers('Mme Boivin, Mme Longuet, M. Basse'), { teachers: ['BOIVIN', 'LONGUET', 'BASSE'], note: null });
  assert.deepEqual(readTeachers('J. GAY/C. JARDILLIER'), { teachers: ['GAY J.', 'JARDILLIER C.'], note: null });
  assert.deepEqual(readTeachers('M. Lardeur (à partir de 9h30)'), { teachers: ['LARDEUR'], note: '(à partir de 9h30)' });
  assert.deepEqual(readTeachers('ST GEORGES Aymeric - Salle F7-F8 - COMMUN LP BAT'), {
    teachers: ['ST GEORGES Aymeric'],
    note: 'Salle F7-F8 - COMMUN LP BAT',
  });
});

test('ce qui n’est pas un nom devient une remarque', () => {
  for (const line of [
    '(1er étage BU)', '(Blender)', '** Correction du DS **', '+ 40 minutes pour 1/3 temps', 'Promo L1 Info',
    'UO Astronomie', 'CDL Russe', 'DU Passerelle', 'Attention DS', 'Atelier MLP', 'Présence OBLIGATOIRE',
    'Liste Prépa CAPEPS', 'Enseignant inconnu', 'M1 EGEDD - L.Hocquez', 'Autonomie',
  ]) {
    assert.deepEqual(readTeachers(line), { teachers: [], note: line }, line);
  }
});

test('les formes partielles se rattachent au seul nom complet qui leur correspond', () => {
  const aliases = teacherAliases(
    ['BASSE David', 'BASSE', 'BOIVIN Severine', 'BOIVIN S.', 'LONGUET VANNOUQUE Julie', 'LONGUET',
      'ROSIER Carole', 'ROSIER Lionel', 'ROSIER C.', 'ROSIER', 'MIGNOT'],
    ['Zoé Descharles', 'Gutierrez Michel'],
  );
  assert.equal(aliases.get('BASSE'), 'BASSE David');
  assert.equal(aliases.get('BOIVIN S.'), 'BOIVIN Severine');
  assert.equal(aliases.get('LONGUET'), 'LONGUET VANNOUQUE Julie');
  assert.equal(aliases.get('ROSIER C.'), 'ROSIER Carole');
  // Deux ROSIER : sans initiale, impossible de choisir. Aucun MIGNOT complet.
  assert.equal(aliases.has('ROSIER'), false);
  assert.equal(aliases.has('MIGNOT'), false);
  // « Zoé Descharles » n'est rattachée que si « DESCHARLES Zoé » est connue.
  assert.equal(aliases.has('Zoé Descharles'), false);
  assert.equal(teacherAliases(['DESCHARLES Zoé'], ['Zoé Descharles']).get('Zoé Descharles'), 'DESCHARLES Zoé');
  assert.equal(
    teacherAliases(['VAN MARCKE DE LUMMEN Jimmy'], ['Van Marcke De Lummen Jimmy']).get('Van Marcke De Lummen Jimmy'),
    'VAN MARCKE DE LUMMEN Jimmy',
  );
});

test('parseAdeIcs sépare enseignants et remarques', () => {
  const ics = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'DTSTART:20260921T063000Z',
    'DTEND:20260921T080000Z',
    'SUMMARY:Infographie TP',
    'DESCRIPTION:\\n\\nBUT1\\n- Line PERON -\\n(Blender)\\nM. Basse\\n',
    'UID:ADE-1',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const [event] = parseAdeIcs(ics);
  assert.deepEqual(event.teachers, ['PERON Line', 'BASSE']);
  assert.deepEqual(event.notes, ['(Blender)']);
  assert.deepEqual(event.groups, ['BUT1']);
});
