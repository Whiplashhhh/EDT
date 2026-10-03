import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encodeGwtLong, parisMidnight } from '../src/ade/gwt.ts';
import { parseAdeIcs } from '../src/ade/ics.ts';
import { formatSelection, parseSelection, subjectOf } from '../src/ade/subjects.ts';
import { mondayOf } from '../src/routes/api.ts';
import { TtlCache } from '../src/cache.ts';

test('encodeGwtLong reproduit l’encodage observé du client ADE', () => {
  // Valeurs relevées dans les requêtes du client officiel.
  assert.equal(encodeGwtLong(1789336800000), 'aCcyMsA');
  assert.equal(encodeGwtLong(1789855200000), 'aC7rvMA');
  assert.equal(encodeGwtLong(0), 'A');
});

test('parisMidnight tient compte de l’heure d’été', () => {
  // Septembre : UTC+2, donc minuit à Paris = 22 h UTC la veille.
  assert.equal(new Date(parisMidnight('2026-09-14')).toISOString(), '2026-09-13T22:00:00.000Z');
  // Décembre : UTC+1.
  assert.equal(new Date(parisMidnight('2026-12-14')).toISOString(), '2026-12-13T23:00:00.000Z');
});

test('mondayOf ramène n’importe quel jour au lundi de sa semaine', () => {
  assert.equal(mondayOf(new Date('2026-09-20T10:00:00Z')), '2026-09-14'); // un dimanche
  assert.equal(mondayOf(new Date('2026-09-14T10:00:00Z')), '2026-09-14'); // le lundi lui-même
  assert.equal(mondayOf(new Date('2026-09-18T23:30:00Z')), '2026-09-14'); // un vendredi tard
});

const SAMPLE = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'BEGIN:VEVENT',
  'DTSTART:20260921T063000Z',
  'DTEND:20260921T080000Z',
  'SUMMARY:R1-08 GO CM',
  'LOCATION:Grand amphi',
  'DESCRIPTION:\\n\\nBUT1\\nLETREZ Séverine\\n(Exporté le:20/09/2026 22:26)\\n',
  'UID:ADE-1',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART:20260921T110000Z',
  'DTEND:20260921T123000Z',
  'SUMMARY:R1-06 Maths TD1',
  'LOCATION:Biblioth',
  ' èque',
  'DESCRIPTION:\\n\\nBUT1-TD1\\nPACOU Anne\\n',
  'UID:ADE-2',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

test('parseAdeIcs extrait matière, type, salle, enseignant et groupe', () => {
  const events = parseAdeIcs(SAMPLE);
  assert.equal(events.length, 2);

  assert.deepEqual(events[0], {
    uid: 'ADE-1',
    start: '2026-09-21T06:30:00.000Z',
    end: '2026-09-21T08:00:00.000Z',
    title: 'R1-08 GO CM',
    subject: 'R1-08 GO',
    kind: 'CM',
    room: 'Grand amphi',
    teachers: ['LETREZ Séverine'],
    groups: ['BUT1'],
  });

  // Le suffixe numéroté « TD1 » doit être reconnu comme un TD…
  assert.equal(events[1].kind, 'TD');
  assert.equal(events[1].subject, 'R1-06 Maths');
  // …et le pliage de ligne iCalendar doit être défait.
  assert.equal(events[1].room, 'Bibliothèque');
});

test('parseAdeIcs ignore un évènement sans date plutôt que d’échouer', () => {
  const broken = SAMPLE.replace('DTSTART:20260921T063000Z\r\n', '');
  const events = parseAdeIcs(broken);
  assert.equal(events.length, 1);
  assert.equal(events[0].uid, 'ADE-2');
});

test('parseAdeIcs trie les cours par heure de début', () => {
  const reversed = parseAdeIcs(SAMPLE.replace('20260921T063000Z', '20260921T163000Z').replace('20260921T080000Z', '20260921T180000Z'));
  assert.deepEqual(reversed.map((e) => e.uid), ['ADE-2', 'ADE-1']);
});

test('TtlCache ne lance qu’un chargement pour des appels simultanés', async () => {
  const cache = new TtlCache<number>(1000);
  let calls = 0;
  const load = async () => { calls += 1; return 42; };
  const [a, b] = await Promise.all([cache.get('k', load), cache.get('k', load)]);
  assert.equal(a, 42);
  assert.equal(b, 42);
  assert.equal(calls, 1);
  assert.equal(cache.peek('k'), 42);
});

test('TtlCache oublie une entrée expirée', async () => {
  const cache = new TtlCache<string>(-1);
  await cache.get('k', async () => 'valeur');
  assert.equal(cache.peek('k'), undefined);
});

test("le flux iCalendar réexposé échappe les caractères spéciaux", async () => {
  // On recharge le module pour accéder à la route sans démarrer de serveur ADE réel.
  const { registerApi } = await import('../src/routes/api.ts');
  const Fastify = (await import('fastify')).default;
  const app = Fastify();
  const service = {
    departments: () => [{ id: 'test', label: 'Test' }],
    catalog: async () => ({ department: 'test', label: 'Test', fetchedAt: '', groups: [] }),
    findGroup: async () => ({ id: 1, name: 'X', path: 'X', depth: 1, children: [] }),
    directory: async () => ({ department: 'test', kind: 'rooms', fetchedAt: '', entries: [] }),
    facetSchedule: async () => { throw new Error('non utilisé'); },
    schedule: async () => ({
      department: 'test',
      kind: 'groups',
      resourceId: 1,
      resourceName: 'BUT1;TD1/../etc',
      from: '2026-09-14',
      fetchedAt: '2026-09-14T00:00:00.000Z',
      events: [{
        uid: 'u1',
        start: '2026-09-14T08:00:00.000Z',
        end: '2026-09-14T09:30:00.000Z',
        title: 'Maths; TD, groupe A',
        subject: 'Maths',
        kind: 'TD',
        room: 'S1,36',
        teachers: ['PACOU Anne'],
        groups: ['BUT1-TD1'],
      }],
    }),
  };
  await app.register(registerApi, { prefix: '/api', service: service as never });

  const res = await app.inject({ method: 'GET', url: '/api/test/groups/1/calendar.ics' });
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'] as string, /text\/calendar/);
  // Le nom de fichier est réduit à des caractères sûrs pour un en-tête HTTP.
  assert.equal(res.headers['content-disposition'], 'inline; filename="edt-BUT1-TD1-..-etc.ics"');
  // Les `;` et `,` du contenu sont échappés conformément à la RFC 5545.
  assert.ok(res.body.includes('SUMMARY:Maths\\; TD\\, groupe A'));
  assert.ok(res.body.includes('LOCATION:S1\\,36'));
  await app.close();
});

test('subjectOf réunit les séances d’une ressource sous un même code', () => {
  const of = (title: string) => subjectOf({ title, subject: title });
  // Tiret ou point, type de séance au bout ou collé au code : même ressource.
  assert.deepEqual(of('R1-01 Dev TPA'), { code: 'R1.01', label: 'Dev' });
  assert.deepEqual(of('R1.13TD1 Expression/Communication'), { code: 'R1.13', label: 'Expression/Communication' });
  assert.deepEqual(of('GEII R1.04 OML1 - TD1 - 1.5'), { code: 'R1.04', label: 'OML1' });
  assert.deepEqual(of('R5.02.PPP'), { code: 'R5.02', label: 'PPP' });
  assert.deepEqual(of('R5.A.05 Prog Avancée F#'), { code: 'R5.A.05', label: 'Prog Avancée F#' });
  assert.deepEqual(of('AS SAE12 Mettre en oeuvre'), { code: 'SAE12', label: 'Mettre en oeuvre' });
  assert.deepEqual(of('SAE 1.1 - CONCEVOIR - TP2 - SIN'), { code: 'SAE1.1', label: 'CONCEVOIR - SIN' });
  assert.deepEqual(of('SAE5.B.00_JV'), { code: 'SAE5.B.00', label: 'JV' });
  // « CC1 » est une matière des GEII, pas un contrôle continu.
  assert.deepEqual(of('R3.02 CC3 - TP4'), { code: 'R3.02', label: 'CC3' });
  // Sans code, l'intitulé lui-même fait office de ressource.
  assert.deepEqual(of('PORTFOLIO - TP2'), { code: 'PORTFOLIO', label: '' });
  // Un type de séance n'est pas un code.
  assert.equal(of('TP2')?.code, undefined);
});

test('une sélection de ressources se lit et s’écrit sous une forme unique', () => {
  // Désordre, doublons : la forme canonique trie et fusionne.
  const picks = parseSelection('34-56-0,12,34-56');
  assert.deepEqual(picks, [
    { id: 12, without: [] },
    { id: 34, without: [0, 56] },
  ]);
  assert.equal(formatSelection(picks!), '12,34-0-56');
  // Formes refusées : vide, identifiant nul, caractères parasites, trop de ressources.
  for (const bad of ['', '0', '12,', '12-a', '12;34', Array.from({ length: 21 }, (_, i) => i + 1).join(',')]) {
    assert.equal(parseSelection(bad), null, bad);
  }
});
