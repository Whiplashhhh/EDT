import assert from 'node:assert/strict';
import { test } from 'node:test';
import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { bodyText, isBot, parseFeedback, subjectLine } from '../src/feedback/message.ts';
import { registerFeedbackRoutes } from '../src/routes/feedback.ts';
import type { OutgoingMail, SendMail } from '../src/feedback/mailer.ts';

const SENT_AT = new Date('2026-10-05T08:30:00Z');

test('objet : le type entre crochets, puis l’objet saisi', () => {
  const f = parseFeedback({ kind: 'suggestion', subject: 'Mode sombre', message: 'Ce serait bien.' });
  assert.equal(subjectLine(f), '[EDT - suggestion] Mode sombre');
  assert.equal(subjectLine(parseFeedback({ kind: 'bug', subject: 'x', message: 'abc' })), '[EDT - problème] x');
  assert.equal(subjectLine(parseFeedback({ kind: 'contact', subject: 'x', message: 'abc' })), '[EDT - contact] x');
});

test('objet : sans objet saisi, le début du message, sur une ligne', () => {
  const short = parseFeedback({ kind: 'contact', message: 'Bonjour\nmerci pour le site' });
  assert.equal(subjectLine(short), '[EDT - contact] Bonjour merci pour le site');
  const long = parseFeedback({ kind: 'contact', message: 'a'.repeat(200) });
  assert.equal(subjectLine(long), `[EDT - contact] ${'a'.repeat(60)}…`);
});

test('un retour à la ligne dans l’objet ne peut pas ajouter d’en-tête', () => {
  const f = parseFeedback({ kind: 'contact', subject: 'Salut\r\nBcc: victime@example.org', message: 'abc' });
  assert.equal(f.subject, 'Salut Bcc: victime@example.org');
  assert.ok(!subjectLine(f).includes('\n'));
});

test('champs obligatoires et bornes', () => {
  assert.throws(() => parseFeedback({ kind: 'spam', message: 'abc' }), /Type de message/);
  assert.throws(() => parseFeedback({ kind: 'bug' }), /Message manquant/);
  assert.throws(() => parseFeedback({ kind: 'bug', message: '  ' }), /Message manquant/);
  assert.throws(() => parseFeedback({ kind: 'bug', message: 'a'.repeat(4001) }), /trop long/);
  assert.throws(() => parseFeedback({ kind: 'bug', subject: 'a'.repeat(121), message: 'abc' }), /trop long/);
  assert.throws(() => parseFeedback({ kind: 'bug', subject: 42, message: 'abc' }), /invalide/);
});

test('adresse de réponse : facultative, mais bien formée', () => {
  assert.equal(parseFeedback({ kind: 'bug', message: 'abc', email: '' }).email, null);
  assert.equal(parseFeedback({ kind: 'bug', message: 'abc', email: ' a.b@univ.fr ' }).email, 'a.b@univ.fr');
  for (const email of ['pas-une-adresse', 'a@b', 'a@b.fr, c@d.fr', 'x <a@b.fr>']) {
    assert.throws(
      () => parseFeedback({ kind: 'bug', message: 'abc', email }),
      (err: Error & { code?: string }) => err.code === 'feedback-email',
      email,
    );
  }
});

test('statut inconnu et contexte mal formé sont ignorés, pas refusés', () => {
  const f = parseFeedback({
    kind: 'bug',
    message: 'abc',
    status: 'admin',
    context: { department: '../etc', identityKind: 'x', identity: 'BUT2 TP1', installed: 'oui', lang: 'fr' },
  });
  assert.equal(f.status, null);
  assert.deepEqual(
    { ...f.context },
    { department: null, identity: 'BUT2 TP1', identityKind: null, viewing: null, lang: 'fr', installed: null, userAgent: null, screen: null },
  );
});

test('corps : identité, message, puis contexte technique', () => {
  const f = parseFeedback({
    kind: 'bug',
    subject: 'Salle fausse',
    message: 'La salle affichée\nn’est pas la bonne.',
    email: 'eleve@etu.univ-littoral.fr',
    status: 'student',
    name: 'Camille Martin',
    context: {
      department: 'iut-info',
      identity: 'BUT2 TP1',
      identityKind: 'groups',
      viewing: 'Salle B012',
      lang: 'fr',
      installed: true,
      userAgent: 'Mozilla/5.0',
      screen: '390×844',
    },
  });
  const text = bodyText(f, { label: 'IUT INFO', city: 'Calais' }, SENT_AT);
  assert.match(text, /^Type : problème\nStatut : Étudiant\nNom : Camille Martin\nRépondre à : eleve@etu\.univ-littoral\.fr\n\nLa salle affichée\nn’est pas la bonne\.\n\n---\n/);
  assert.match(text, /Formation : IUT INFO — Calais/);
  assert.match(text, /Emploi du temps \(classe\) : BUT2 TP1/);
  assert.match(text, /Affiché au moment de l’envoi : Salle B012/);
  assert.match(text, /Application installée : oui/);
  assert.match(text, /Envoyé le : lundi 5 octobre 2026 à 10:30/);
});

test('corps : sans adresse ni contexte, on le dit', () => {
  const text = bodyText(parseFeedback({ kind: 'contact', message: 'Bonjour' }), null, SENT_AT);
  assert.match(text, /Répondre à : non communiqué/);
  assert.match(text, /Informations techniques non jointes\./);
  assert.ok(!text.includes('Statut'));
});

test('champ piège', () => {
  assert.equal(isBot({ website: '' }), false);
  assert.equal(isBot({}), false);
  assert.equal(isBot({ website: 'http://spam.example' }), true);
});

/** Application minimale : la route, la limite de débit, et un faux service d'envoi. */
async function makeApp(send: SendMail | null, maxPerHour = 5) {
  const app = Fastify();
  await app.register(rateLimit, { max: 1000, timeWindow: '1 minute' });
  await app.register(registerFeedbackRoutes, {
    prefix: '/api',
    send,
    maxPerHour,
    describeDepartment: async (id) => (id === 'iut-info' ? { label: 'IUT INFO', city: 'Calais' } : null),
  });
  return app;
}

const post = (app: Awaited<ReturnType<typeof makeApp>>, payload: object) =>
  app.inject({ method: 'POST', url: '/api/feedback', payload });

test('route : le message part, avec l’adresse en Reply-To et la formation résolue', async () => {
  const sent: OutgoingMail[] = [];
  const app = await makeApp(async (mail) => { sent.push(mail); });

  const res = await post(app, {
    kind: 'suggestion',
    subject: 'Export PDF',
    message: 'Pouvoir imprimer la semaine.',
    email: 'prof@univ-littoral.fr',
    context: { department: 'iut-info', identity: 'Dupont', identityKind: 'teachers' },
  });
  assert.equal(res.statusCode, 204);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].subject, '[EDT - suggestion] Export PDF');
  assert.equal(sent[0].replyTo, 'prof@univ-littoral.fr');
  assert.match(sent[0].text, /Formation : IUT INFO — Calais/);
  assert.match(sent[0].text, /Emploi du temps \(enseignant\) : Dupont/);
});

test('route : un robot est éconduit en silence', async () => {
  const sent: OutgoingMail[] = [];
  const app = await makeApp(async (mail) => { sent.push(mail); });
  const res = await post(app, { kind: 'contact', message: 'Achetez', website: 'spam' });
  assert.equal(res.statusCode, 204);
  assert.equal(sent.length, 0);
});

test('route : désactivée sans SMTP', async () => {
  const app = await makeApp(null);
  assert.deepEqual((await app.inject('/api/feedback/config')).json(), { enabled: false });
  const res = await post(app, { kind: 'contact', message: 'Bonjour' });
  assert.equal(res.statusCode, 503);
});

test('route : un échec d’envoi est signalé au client', async () => {
  const app = await makeApp(async () => { throw new Error('SMTP en panne'); });
  const res = await post(app, { kind: 'contact', message: 'Bonjour' });
  assert.equal(res.statusCode, 502);
});

test('route : quelques messages par heure, pas davantage', async () => {
  const app = await makeApp(async () => {}, 2);
  assert.equal((await post(app, { kind: 'contact', message: 'premier' })).statusCode, 204);
  assert.equal((await post(app, { kind: 'contact', message: 'deuxième' })).statusCode, 204);
  assert.equal((await post(app, { kind: 'contact', message: 'troisième' })).statusCode, 429);
  // La limite ne touche que l'envoi : la configuration reste lisible.
  assert.equal((await app.inject('/api/feedback/config')).statusCode, 200);
});
