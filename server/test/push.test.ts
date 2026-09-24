import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { CourseEvent } from '../src/ade/ics.ts';
import {
  BETWEEN_COURSES_LEAD_MS,
  FIRST_COURSE_LEAD_MS,
  changesWithin,
  diffSchedules,
  dueReminders,
  remindersFor,
  sessionsOf,
  snapshotOf,
} from '../src/push/planner.ts';
import { changeNotification, nextCourseNotification } from '../src/push/messages.ts';
import { SubscriptionStore, type PushSubscription } from '../src/push/store.ts';
import { Notifier } from '../src/push/notifier.ts';

/** Un cours minimal : seuls les champs que le planificateur regarde sont renseignés. */
function course(partial: Partial<CourseEvent> & { start: string; end: string }): CourseEvent {
  return {
    uid: partial.uid ?? `uid-${partial.start}`,
    title: partial.title ?? 'R1-01 Dev TP',
    subject: partial.subject ?? 'R1-01 Dev',
    kind: partial.kind ?? 'TP',
    room: partial.room ?? 'S201',
    teachers: partial.teachers ?? ['DUPONT'],
    groups: partial.groups ?? ['BUT1-TD1'],
    ...partial,
  };
}

/* Une journée type, en heure de Paris (septembre : UTC+2).
   8 h 00 – 9 h 30, puis 9 h 45 – 11 h 15, puis 14 h 00 – 15 h 30 après une longue pause. */
const MORNING = course({ start: '2026-09-21T06:00:00.000Z', end: '2026-09-21T07:30:00.000Z', uid: 'a' });
const LATE_MORNING = course({ start: '2026-09-21T07:45:00.000Z', end: '2026-09-21T09:15:00.000Z', uid: 'b' });
const AFTERNOON = course({ start: '2026-09-21T12:00:00.000Z', end: '2026-09-21T13:30:00.000Z', uid: 'c' });
const DAY = [MORNING, LATE_MORNING, AFTERNOON];

test('le premier cours de la journée est annoncé 30 minutes avant son début', () => {
  const reminders = remindersFor(DAY);
  const first = reminders.find((r) => r.event.uid === 'a');
  assert.ok(first);
  assert.equal(first.at, Date.parse(MORNING.start) - FIRST_COURSE_LEAD_MS);
});

test('les cours suivants sont annoncés 10 minutes avant la fin du cours précédent', () => {
  const reminders = remindersFor(DAY);

  const second = reminders.find((r) => r.event.uid === 'b');
  assert.ok(second);
  assert.equal(second.at, Date.parse(MORNING.end) - BETWEEN_COURSES_LEAD_MS);

  // Après une longue pause, le rappel part tout de même à la fin du cours d'avant.
  const third = reminders.find((r) => r.event.uid === 'c');
  assert.ok(third);
  assert.equal(third.at, Date.parse(LATE_MORNING.end) - BETWEEN_COURSES_LEAD_MS);
});

test('chaque journée repart sur la règle du premier cours', () => {
  const nextDay = course({ start: '2026-09-22T06:00:00.000Z', end: '2026-09-22T07:30:00.000Z', uid: 'd' });
  const reminders = remindersFor([...DAY, nextDay]);
  const monday = reminders.find((r) => r.event.uid === 'd');
  assert.ok(monday);
  // Et non 10 minutes avant la fin du dernier cours de la veille.
  assert.equal(monday.at, Date.parse(nextDay.start) - FIRST_COURSE_LEAD_MS);
});

test('deux cours à la même heure ne font qu’un seul créneau', () => {
  const twin = course({ start: MORNING.start, end: MORNING.end, uid: 'a-bis', room: 'S134' });
  const sessions = sessionsOf([MORNING, twin, LATE_MORNING]);
  assert.equal(sessions.length, 2);
  assert.equal(sessions[0].events.length, 2);
  // Un seul rappel pour ce créneau, donc un seul réveil du téléphone.
  assert.equal(remindersFor([MORNING, twin, LATE_MORNING]).length, 2);
});

test('un rappel ne part jamais après le début du cours qu’il annonce', () => {
  // Cours qui se chevauchent : la fin du précédent tombe après le début du suivant.
  const long = course({ start: '2026-09-21T06:00:00.000Z', end: '2026-09-21T10:00:00.000Z', uid: 'long' });
  const overlapping = course({ start: '2026-09-21T08:00:00.000Z', end: '2026-09-21T09:30:00.000Z', uid: 'over' });
  const reminder = remindersFor([long, overlapping]).find((r) => r.event.uid === 'over');
  assert.ok(reminder);
  assert.equal(reminder.at, Date.parse(overlapping.start));
});

test('dueReminders ne retient que les rappels échus depuis peu et pas encore commencés', () => {
  const at = Date.parse(MORNING.start) - FIRST_COURSE_LEAD_MS;
  const grace = 4 * 60_000;

  assert.equal(dueReminders(DAY, at - 60_000, grace).length, 0, 'pas encore l’heure');
  assert.equal(dueReminders(DAY, at, grace).length, 1, 'à l’heure pile');
  assert.equal(dueReminders(DAY, at + 3 * 60_000, grace).length, 1, 'trois minutes de retard, rattrapé');
  assert.equal(dueReminders(DAY, at + 10 * 60_000, grace).length, 0, 'trop tard, on se tait');

  // Un cours déjà commencé n'est plus « le prochain », même dans le délai de grâce.
  const started = Date.parse(MORNING.start) + 60_000;
  assert.equal(
    dueReminders([MORNING], started, 60 * 60_000).length,
    0,
    'le cours a commencé',
  );
});

test('diffSchedules distingue ajout, suppression, salle, horaire et intervenant', () => {
  const before = snapshotOf([
    MORNING,
    LATE_MORNING,
    AFTERNOON,
    course({ start: '2026-09-21T15:00:00.000Z', end: '2026-09-21T16:30:00.000Z', uid: 'gone' }),
  ]);
  const after = snapshotOf([
    // Changement de salle.
    { ...MORNING, room: 'S134' },
    // Déplacement d'horaire.
    { ...LATE_MORNING, start: '2026-09-21T08:00:00.000Z', end: '2026-09-21T09:30:00.000Z' },
    // Changement d'intervenant.
    { ...AFTERNOON, teachers: ['MARTIN'] },
    // Cours ajouté.
    course({ start: '2026-09-21T16:00:00.000Z', end: '2026-09-21T17:30:00.000Z', uid: 'new' }),
  ]);

  const byUid = new Map(diffSchedules(before, after).map((c) => [c.event.uid, c.kind]));
  assert.equal(byUid.get('a'), 'room');
  assert.equal(byUid.get('b'), 'time');
  assert.equal(byUid.get('c'), 'teachers');
  assert.equal(byUid.get('new'), 'added');
  assert.equal(byUid.get('gone'), 'removed');
  assert.equal(byUid.size, 5);
});

test('un emploi du temps inchangé ne produit aucun changement', () => {
  assert.deepEqual(diffSchedules(snapshotOf(DAY), snapshotOf([...DAY])), []);
});

test('changesWithin ne garde que les deux prochains jours, cours passés exclus', () => {
  const now = Date.parse('2026-09-21T05:00:00.000Z');
  const window = 2 * 24 * 60 * 60_000;

  const past = course({ start: '2026-09-21T04:00:00.000Z', end: '2026-09-21T05:30:00.000Z', uid: 'past' });
  const soon = course({ start: '2026-09-22T06:00:00.000Z', end: '2026-09-22T07:30:00.000Z', uid: 'soon' });
  const far = course({ start: '2026-09-28T06:00:00.000Z', end: '2026-09-28T07:30:00.000Z', uid: 'far' });

  const kept = changesWithin(
    [
      { kind: 'room', event: past },
      { kind: 'room', event: soon },
      { kind: 'added', event: far },
    ],
    now,
    window,
  );
  assert.deepEqual(kept.map((c) => c.event.uid), ['soon']);
});

/*
 * ADE sert une fenêtre glissante : sans précaution, un cours que le temps fait
 * simplement entrer dans l'horizon des deux jours passerait pour un ajout.
 * La comparaison porte donc sur toute la fenêtre, le filtrage vient après.
 */
test('le passage du temps n’invente pas de changement', () => {
  const twelveWeeks = [MORNING, LATE_MORNING, AFTERNOON, course({ start: '2026-10-05T06:00:00.000Z', end: '2026-10-05T07:30:00.000Z', uid: 'later' })];
  const snapshot = snapshotOf(twelveWeeks);

  const changes = diffSchedules(snapshot, snapshotOf(twelveWeeks));
  assert.deepEqual(changesWithin(changes, Date.parse('2026-10-03T08:00:00.000Z'), 2 * 24 * 60 * 60_000), []);
});

test('les notifications se lisent en français comme en anglais', () => {
  const next = nextCourseNotification(MORNING, 'fr');
  assert.match(next.title, /Prochain cours à 08:00/);
  assert.match(next.body, /R1-01 Dev \(TP\)/);
  assert.match(next.body, /salle S201/);
  assert.equal(next.day, '2026-09-21');

  assert.match(nextCourseNotification(MORNING, 'en').title, /Next class at 08:00/);

  const moved = changeNotification({ kind: 'room', event: { ...MORNING, room: 'S134' }, previous: MORNING }, 'fr');
  assert.match(moved.title, /Changement de salle/);
  assert.match(moved.body, /S201 → S134/);

  const rescheduled = changeNotification(
    { kind: 'time', event: { ...MORNING, start: '2026-09-21T08:00:00.000Z' }, previous: MORNING },
    'fr',
  );
  assert.match(rescheduled.body, /08:00 →/);
});

test('le registre des abonnements survit à un redémarrage', () => {
  const dir = mkdtempSync(join(tmpdir(), 'edt-push-'));
  const path = join(dir, 'subscriptions.json');
  try {
    const sub: PushSubscription = {
      endpoint: 'https://push.example.org/abc',
      keys: { p256dh: 'k'.repeat(64), auth: 'a'.repeat(22) },
      department: 'iut-info',
      kind: 'groups',
      resourceId: 42,
      resourceName: 'BUT1-TD1',
      nextCourse: true,
      changes: true,
      lang: 'fr',
      updatedAt: '2026-09-21T08:00:00.000Z',
    };

    const store = new SubscriptionStore(path);
    store.save(sub);
    store.flush();

    const reloaded = new SubscriptionStore(path);
    assert.equal(reloaded.size, 1);
    assert.deepEqual(reloaded.get(sub.endpoint), sub);

    // Les abonnés d'une même classe sont regroupés : un seul emploi du temps à charger.
    const groups = reloaded.byResource();
    assert.deepEqual([...groups.keys()], ['iut-info:groups:42']);

    reloaded.remove(sub.endpoint);
    reloaded.flush();
    assert.equal(new SubscriptionStore(path).size, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('un registre illisible ne bloque pas le démarrage', () => {
  const dir = mkdtempSync(join(tmpdir(), 'edt-push-'));
  const path = join(dir, 'subscriptions.json');
  try {
    writeFileSync(path, '{ ceci n’est pas du JSON');
    assert.equal(new SubscriptionStore(path).size, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('un abonnement sans option activée n’est pas suivi', () => {
  const dir = mkdtempSync(join(tmpdir(), 'edt-push-'));
  try {
    const store = new SubscriptionStore(join(dir, 'subscriptions.json'));
    store.save({
      endpoint: 'https://push.example.org/muet',
      keys: { p256dh: 'k'.repeat(64), auth: 'a'.repeat(22) },
      department: 'iut-info',
      kind: 'groups',
      resourceId: 42,
      resourceName: 'BUT1-TD1',
      nextCourse: false,
      changes: false,
      lang: 'fr',
      updatedAt: '2026-09-21T08:00:00.000Z',
    });
    assert.equal(store.size, 1);
    assert.equal(store.byResource().size, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* --- Le planificateur, de bout en bout, avec un ADE et un service de push simulés. --- */

/** Journal des notifications parties, à la place d'un vrai envoi chiffré. */
function fakeSender() {
  const sent = [];
  return {
    sent,
    async send(sub, notification) {
      sent.push({ endpoint: sub.endpoint, title: notification.title, body: notification.body });
      return true;
    },
  };
}

/** Un `AdeService` réduit à ce que le planificateur lui demande. */
function fakeService(pages) {
  let call = 0;
  return {
    async schedule() {
      // Chaque appel sert l'état suivant : c'est ainsi qu'on simule un changement à ADE.
      const events = pages[Math.min(call, pages.length - 1)];
      call += 1;
      return { events };
    },
    async facetSchedule() {
      throw new Error('non utilisé dans ce test');
    },
  };
}

const SILENT = { info() {}, warn() {}, error() {} };

function subscriber(overrides = {}) {
  return {
    endpoint: 'https://push.example.org/one',
    keys: { p256dh: 'k'.repeat(64), auth: 'a'.repeat(22) },
    department: 'iut-info',
    kind: 'groups',
    resourceId: 4445,
    resourceName: 'BUT1-TPA',
    nextCourse: true,
    changes: true,
    lang: 'fr',
    updatedAt: '2026-09-21T00:00:00.000Z',
    ...overrides,
  };
}

function storeWith(subs) {
  const dir = mkdtempSync(join(tmpdir(), 'edt-push-'));
  const store = new SubscriptionStore(join(dir, 'subscriptions.json'));
  for (const sub of subs) store.save(sub);
  return { store, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('le planificateur annonce le prochain cours une seule fois', async () => {
  const { store, cleanup } = storeWith([subscriber({ changes: false })]);
  const sender = fakeSender();
  const notifier = new Notifier(fakeService([DAY]), store, sender, SILENT, { pollMs: 60_000 });
  try {
    const at = Date.parse(MORNING.start) - FIRST_COURSE_LEAD_MS;

    await notifier.tick(at - 60_000);
    assert.equal(sender.sent.length, 0, 'trop tôt');

    await notifier.tick(at);
    assert.equal(sender.sent.length, 1);
    assert.match(sender.sent[0].title, /Prochain cours à 08:00/);

    // Le battement suivant retombe dans le délai de grâce : il ne doit pas répéter.
    await notifier.tick(at + 60_000);
    assert.equal(sender.sent.length, 1, 'une seule annonce par créneau');
  } finally {
    cleanup();
  }
});

test('le premier relevé ne signale aucun changement', async () => {
  const { store, cleanup } = storeWith([subscriber({ nextCourse: false })]);
  const sender = fakeSender();
  // Un seul état : le planificateur n'a rien à quoi comparer au premier passage.
  const notifier = new Notifier(fakeService([DAY]), store, sender, SILENT, { pollMs: 0 });
  try {
    await notifier.tick(Date.parse('2026-09-20T09:00:00.000Z'));
    await notifier.tick(Date.parse('2026-09-20T09:05:00.000Z'));
    assert.deepEqual(sender.sent, [], 'la semaine entière ne doit pas être annoncée comme ajoutée');
  } finally {
    cleanup();
  }
});

test('un changement de salle dans les deux jours réveille les abonnés de la classe', async () => {
  const moved = [{ ...MORNING, room: 'S134' }, LATE_MORNING, AFTERNOON];
  const { store, cleanup } = storeWith([
    subscriber({ nextCourse: false }),
    subscriber({ endpoint: 'https://push.example.org/two', nextCourse: false, lang: 'en' }),
  ]);
  const sender = fakeSender();
  // `pollMs: 0` force un relevé à chaque battement : le deuxième voit le changement.
  const notifier = new Notifier(fakeService([DAY, moved]), store, sender, SILENT, { pollMs: 0 });
  try {
    const at = Date.parse('2026-09-20T09:00:00.000Z');
    await notifier.tick(at);
    assert.equal(sender.sent.length, 0);

    await notifier.tick(at + 60_000);
    assert.equal(sender.sent.length, 2, 'les deux abonnés de la classe sont prévenus');
    // Chacun dans sa langue.
    assert.match(sender.sent[0].title, /Changement de salle/);
    assert.match(sender.sent[1].title, /Room changed/);
    assert.match(sender.sent[0].body, /S201 → S134/);

    // Le même changement, relevé à nouveau, ne sonne pas deux fois.
    await notifier.tick(at + 120_000);
    assert.equal(sender.sent.length, 2);
  } finally {
    cleanup();
  }
});

test('un changement au-delà de deux jours ne réveille personne', async () => {
  const far = course({ start: '2026-09-28T06:00:00.000Z', end: '2026-09-28T07:30:00.000Z', uid: 'far' });
  const { store, cleanup } = storeWith([subscriber({ nextCourse: false })]);
  const sender = fakeSender();
  const notifier = new Notifier(
    fakeService([[far], [{ ...far, room: 'S999' }]]),
    store,
    sender,
    SILENT,
    { pollMs: 0 },
  );
  try {
    const at = Date.parse('2026-09-21T09:00:00.000Z');
    await notifier.tick(at);
    await notifier.tick(at + 60_000);
    assert.deepEqual(sender.sent, [], 'la semaine prochaine se découvre en ouvrant l’application');
  } finally {
    cleanup();
  }
});

test('un abonné qui n’a demandé que les changements ne reçoit pas les rappels', async () => {
  const { store, cleanup } = storeWith([subscriber({ nextCourse: false, changes: true })]);
  const sender = fakeSender();
  const notifier = new Notifier(fakeService([DAY]), store, sender, SILENT, { pollMs: 60_000 });
  try {
    await notifier.tick(Date.parse(MORNING.start) - FIRST_COURSE_LEAD_MS);
    assert.deepEqual(sender.sent, []);
  } finally {
    cleanup();
  }
});

test('une avalanche de changements se résume en une notification', async () => {
  const day = (n) =>
    course({
      uid: `bulk-${n}`,
      start: `2026-09-22T0${n}:00:00.000Z`,
      end: `2026-09-22T0${n}:45:00.000Z`,
    });
  const before = [1, 2, 3, 4, 5, 6, 7].map(day);
  const after = before.map((e) => ({ ...e, room: 'S999' }));

  const { store, cleanup } = storeWith([subscriber({ nextCourse: false })]);
  const sender = fakeSender();
  const notifier = new Notifier(fakeService([before, after]), store, sender, SILENT, {
    pollMs: 0,
    maxChangeNotifications: 5,
  });
  try {
    const at = Date.parse('2026-09-21T09:00:00.000Z');
    await notifier.tick(at);
    await notifier.tick(at + 60_000);

    assert.equal(sender.sent.length, 6, 'cinq changements détaillés, plus un résumé');
    assert.match(sender.sent[5].title, /Emploi du temps modifié/);
    assert.match(sender.sent[5].body, /2 autres changements/);
  } finally {
    cleanup();
  }
});
