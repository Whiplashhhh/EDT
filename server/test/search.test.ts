import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error — module du front, en JavaScript.
import { searchGroups } from '../../web/src/search.js';

// Extrait de l'arbre des classes de Calais, tel que le sélecteur l'aplatit.
const PATHS = [
  'IUT INFO › BUT1',
  'IUT INFO › BUT1 › BUT1-TD2',
  'IUT INFO › BUT2',
  'IUT INFO › BUT2 › BUT2-TD1',
  'IUT INFO › BUT2 › BUT2-TD1 › BUT2-TPA-PA',
  'EILCO Calais › ING2 - Informatique',
  'EILCO Calais › ING2 FISEA - Informatique › INFO 2 - FISEA',
  'EILCO Calais › CP2 › CP2 TD1 Parcours INFO-GEE-GI',
  'CGU Calais › LICENCE 1 › LICENCE 1 STS INFORMATIQUE A CALAIS › Semestre 3 › Groupe 12',
  'CGU Calais › LICENCE 1 › LICENCE 1 STS INFORMATIQUE A CALAIS › Semestre 3 › TD Info 4 Spé Gpe A',
];
const GROUPS = PATHS.map((path) => {
  const levels = path.split(' › ');
  return { name: levels.at(-1), parents: levels.slice(0, -1), path };
});
const search = (query: string) => searchGroups(GROUPS, query).map((g: { path: string }) => g.path);

test('le nom de la formation, porté par un dossier parent, se cherche aussi', () => {
  assert.deepEqual(search('but info').slice(0, 2), ['IUT INFO › BUT1', 'IUT INFO › BUT2']);
  assert.ok(search('iut info').includes('IUT INFO › BUT2 › BUT2-TD1'));
});

test('« info 2 » trouve la promotion BUT2 en premier, puis ses groupes', () => {
  const found = search('info 2');
  assert.equal(found[0], 'IUT INFO › BUT2');
  assert.ok(found.indexOf('IUT INFO › BUT2 › BUT2-TD1') < found.indexOf('EILCO Calais › CP2 › CP2 TD1 Parcours INFO-GEE-GI'));
  assert.ok(found.includes('EILCO Calais › ING2 FISEA - Informatique › INFO 2 - FISEA'));
});

test('lettres et chiffres collés se cherchent ensemble ou séparés, dans n’importe quel ordre', () => {
  assert.equal(search('but2 td1')[0], 'IUT INFO › BUT2 › BUT2-TD1');
  assert.equal(search('td1 but 2')[0], 'IUT INFO › BUT2 › BUT2-TD1');
  // « td1 » ne retrouve pas « BUT1-TD2 », ni « 2 » le groupe « 12 ».
  assert.ok(!search('but2 td1').includes('IUT INFO › BUT1 › BUT1-TD2'));
  assert.ok(!search('groupe 2').length);
});

test('ni la casse ni les accents ne comptent', () => {
  assert.deepEqual(search('SPE'), search('spé'));
  assert.equal(search('spe').length, 1);
});

test('une recherche vide ne trouve rien', () => {
  assert.deepEqual(search('  '), []);
  assert.deepEqual(search('— /'), []);
});
