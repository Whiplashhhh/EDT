import assert from 'node:assert/strict';
import { test } from 'node:test';
import { injectPreview, previewText, readSharedPage } from '../src/share/preview.ts';
// @ts-expect-error — module du front, en JavaScript.
import { readSharedPage as readInBrowser, shareUrl } from '../../web/src/share.js';

const query = (search: string) => Object.fromEntries(new URLSearchParams(search));

test('une semaine partagée se lit, ramenée à son lundi', () => {
  assert.deepEqual(readSharedPage(query('edt=info/groups/1234&semaine=2026-10-07')), {
    department: 'info', kind: 'groups', resourceId: 1234, period: 'week', day: '2026-10-05',
  });
  assert.deepEqual(readSharedPage(query('edt=all/teachers/42&jour=2026-10-07')), {
    department: 'all', kind: 'teachers', resourceId: 42, period: 'day', day: '2026-10-07',
  });
});

test('seule une ressource précise et une date valide ouvrent la lecture seule', () => {
  assert.equal(readSharedPage(query('edt=info/groups/1234')), null);
  assert.equal(readSharedPage(query('edt=info&semaine=2026-10-05')), null);
  assert.equal(readSharedPage(query('edt=all/groups/1234&jour=2026-10-05')), null);
  assert.equal(readSharedPage(query('edt=info/rooms/12&jour=2026-10-05')), null);
  assert.equal(readSharedPage(query('edt=info/groups/abc&jour=2026-10-05')), null);
  assert.equal(readSharedPage(query('edt=info/groups/1234&jour=2026-13-40')), null);
  assert.equal(readSharedPage(query('edt=info/groups/1234&jour=demain')), null);
});

test('le front et le serveur lisent la même adresse de la même façon', () => {
  Object.assign(globalThis, { location: { origin: 'https://edt.example', pathname: '/' } });
  const target = { department: 'info', kind: 'groups', resourceId: 1234 };
  const week = new URL(shareUrl(target, { period: 'week', day: '2026-10-08' }));
  assert.equal(week.search, '?edt=info/groups/1234&semaine=2026-10-05');
  const day = new URL(shareUrl(target, { period: 'day', day: '2026-10-08' }));
  assert.equal(day.search, '?edt=info/groups/1234&jour=2026-10-08');
  for (const url of [week, day]) {
    const server = readSharedPage(query(url.search))!;
    const browser = readInBrowser(url.search);
    assert.deepEqual({ ...browser.link, period: browser.period, day: browser.day }, server);
  }
  // Sans période, c'est un lien d'application ordinaire.
  assert.equal(readInBrowser(new URL(shareUrl(target)).search), null);
});

test("l'aperçu nomme la classe et la période", () => {
  const week = readSharedPage(query('edt=info/groups/1234&semaine=2026-10-05'))!;
  assert.deepEqual(previewText(week, { name: 'BUT2-TD1', departmentLabel: 'IUT INFO' }), {
    title: 'BUT2-TD1 · Semaine du 5 octobre',
    description: 'IUT INFO — Les cours de la semaine du lundi 5 octobre, tenus à jour depuis ADE.',
  });
  const day = readSharedPage(query('edt=info/groups/1234&jour=2026-10-07'))!;
  assert.deepEqual(previewText(day, { name: null }), {
    title: 'Emploi du temps · Mercredi 7 octobre',
    description: 'Les cours du mercredi 7 octobre, tenus à jour depuis ADE.',
  });
});

test("l'aperçu remplace les balises de la page, échappées", () => {
  const html = [
    '<meta name="description" content="Général" />',
    '<meta property="og:url" content="https://edt.example/" />',
    '<meta property="og:title" content="EDT ULCO" />',
    '<meta property="og:description" content="Général" />',
    '<title>EDT ULCO</title>',
  ].join('\n');
  const out = injectPreview(html, { title: 'TD "A" & <B>', description: 'Desc', path: '/?edt=info/groups/1&jour=2026-10-07' });
  assert.match(out, /<title>TD &quot;A&quot; &amp; &lt;B&gt;<\/title>/);
  assert.match(out, /og:title" content="TD &quot;A&quot; &amp; &lt;B&gt;"/);
  assert.match(out, /og:description" content="Desc"/);
  assert.match(out, /name="description" content="Desc"/);
  assert.match(out, /og:url" content="https:\/\/edt.example\/\?edt=info\/groups\/1&amp;jour=2026-10-07"/);
});
