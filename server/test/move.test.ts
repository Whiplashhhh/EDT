import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { movedUrl, registerMove } from '../src/move.ts';
import { announceMove } from '../src/push/move.ts';
import { SubscriptionStore, type PushSubscription } from '../src/push/store.ts';
import { registerApi } from '../src/routes/api.ts';

const MOVE = { from: ['edt-iut.online'], to: 'https://edt-ulco.fr' };

test('une page garde son chemin et sa requête, et reçoit le marqueur', () => {
  assert.equal(movedUrl(MOVE, '/'), 'https://edt-ulco.fr/?demenage=1');
  assert.equal(movedUrl(MOVE, '/?edt=info/groups/12&day=2026-10-14'), 'https://edt-ulco.fr/?edt=info/groups/12&day=2026-10-14&demenage=1');
  assert.equal(movedUrl(MOVE, '/emploi-du-temps-ulco-calais/'), 'https://edt-ulco.fr/emploi-du-temps-ulco-calais/?demenage=1');
});

test('un fichier ou un appel d’API est redirigé tel quel', () => {
  assert.equal(movedUrl(MOVE, '/sitemap.xml'), 'https://edt-ulco.fr/sitemap.xml');
  assert.equal(movedUrl(MOVE, '/api/info/groups/12/schedule?from=2026-10-12'), 'https://edt-ulco.fr/api/info/groups/12/schedule?from=2026-10-12');
});

/** Un serveur réduit à la redirection et à l'API, sur un emploi du temps factice. */
async function server() {
  const app = Fastify();
  registerMove(app, MOVE);
  const service = {
    schedule: async () => ({
      department: 'info',
      kind: 'groups',
      resourceId: 12,
      resourceName: 'BUT1 TD1',
      from: '2026-10-12',
      fetchedAt: '2026-10-12T00:00:00.000Z',
      events: [
        // 23 h 30 à Paris le 12, mais 21 h 30 UTC : c'est le jour de Paris qui compte.
        { uid: 'a', start: '2026-10-12T21:30:00.000Z', end: '2026-10-12T22:00:00.000Z', title: 'Maths', subject: 'Maths', kind: 'CM', room: '', teachers: [], groups: [] },
        { uid: 'b', start: '2026-10-12T08:00:00.000Z', end: '2026-10-12T09:00:00.000Z', title: 'Algo', subject: 'Algo', kind: 'TD', room: '', teachers: [], groups: [] },
        { uid: 'c', start: '2026-10-14T08:00:00.000Z', end: '2026-10-14T09:00:00.000Z', title: 'Web', subject: 'Web', kind: 'TP', room: '', teachers: [], groups: [] },
      ],
    }),
  };
  await app.register(registerApi, { prefix: '/api', service: service as never, crous: {} as never, move: MOVE });
  app.get('/', async () => 'accueil');
  return app;
}

test('l’ancien domaine renvoie vers le nouveau en 301', async () => {
  const app = await server();
  const res = await app.inject({ method: 'GET', url: '/?edt=info/groups/12', headers: { host: 'edt-iut.online' } });
  assert.equal(res.statusCode, 301);
  assert.equal(res.headers.location, 'https://edt-ulco.fr/?edt=info/groups/12&demenage=1');

  const here = await app.inject({ method: 'GET', url: '/', headers: { host: 'edt-ulco.fr' } });
  assert.equal(here.statusCode, 200);
  await app.close();
});

test('l’agenda de l’ancien domaine reste servi, avec un avertissement par jour de cours', async () => {
  const app = await server();
  const url = '/api/info/groups/12/calendar.ics';

  const old = await app.inject({ method: 'GET', url, headers: { host: 'edt-iut.online' } });
  assert.equal(old.statusCode, 200);
  const notices = old.body.match(/UID:demenagement-\d+@edt-ulco\.fr/g);
  assert.deepEqual(notices, ['UID:demenagement-20261012@edt-ulco.fr', 'UID:demenagement-20261014@edt-ulco.fr']);
  assert.ok(old.body.includes('DTSTART;VALUE=DATE:20261012\r\nDTEND;VALUE=DATE:20261013'));
  assert.ok(old.body.includes('réabonnez-vous sur edt-ulco.fr'));

  const fresh = await app.inject({ method: 'GET', url, headers: { host: 'edt-ulco.fr' } });
  assert.ok(!fresh.body.includes('demenagement'));
  await app.close();
});

/** Abonnés : un d'avant le changement d'adresse, un arrivé par l'ancien domaine, un par le nouveau. */
function farewellStore() {
  const base = {
    keys: { p256dh: 'k'.repeat(64), auth: 'a'.repeat(22) },
    department: 'info', kind: 'groups' as const, resourceId: 12, resourceName: 'BUT1 TD1',
    nextCourse: true, changes: true, menu: false, updatedAt: '2026-10-01T08:00:00.000Z',
  };
  const store = new SubscriptionStore(join(mkdtempSync(join(tmpdir(), 'edt-move-')), 'subscriptions.json'));
  store.save({ ...base, endpoint: 'https://push.example.org/avant', lang: 'fr' });
  store.save({ ...base, endpoint: 'https://push.example.org/ancien', lang: 'de', host: 'edt-iut.online' });
  store.save({ ...base, endpoint: 'https://push.example.org/nouveau', lang: 'fr', host: 'edt-ulco.fr' });
  return store;
}

test('les anciens abonnés reçoivent une seule notification, courte, puis sont oubliés', async () => {
  const store = farewellStore();
  const sent: Array<{ endpoint: string; title: string; body: string }> = [];
  const sender = {
    send: async (sub: PushSubscription, n: { title: string; body: string }) => {
      sent.push({ endpoint: sub.endpoint, title: n.title, body: n.body });
      return true;
    },
  };
  // 14 h à Paris.
  const afternoon = new Date('2026-10-15T12:00:00Z');

  assert.deepEqual(await announceMove(store, sender, MOVE, afternoon), { sent: 2, failed: 0 });
  assert.deepEqual(sent.map((s) => s.endpoint), ['https://push.example.org/avant', 'https://push.example.org/ancien']);
  assert.equal(sent[0].title, 'EDT ULCO a déménagé');
  assert.match(sent[0].body, /edt-ulco\.fr/);
  assert.match(sent[1].title, /has moved/);
  for (const s of sent) assert.ok(s.title.length + s.body.length <= 110, `trop long : ${s.body}`);
  assert.deepEqual(store.all().map((s) => s.endpoint), ['https://push.example.org/nouveau']);

  // Une seconde passe ne renvoie rien.
  assert.deepEqual(await announceMove(store, sender, MOVE, afternoon), { sent: 0, failed: 0 });
  assert.equal(sent.length, 2);
});

test('la notification d’adieu attend la journée, et un échec n’est pas retenté', async () => {
  const store = farewellStore();
  let calls = 0;
  const failing = { send: async () => { calls++; throw new Error('service de push injoignable'); } };

  // 3 h à Paris : on attend.
  assert.deepEqual(await announceMove(store, failing, MOVE, new Date('2026-10-15T01:00:00Z')), { sent: 0, failed: 0 });
  assert.equal(calls, 0);
  assert.equal(store.size, 3);

  assert.deepEqual(await announceMove(store, failing, MOVE, new Date('2026-10-15T08:00:00Z')), { sent: 0, failed: 2 });
  assert.equal(store.size, 1);
});
