import { generateVapidKeys } from '../src/push/sender.ts';

/**
 * Fabrique une paire de clés VAPID pour les notifications push.
 *
 * À lancer une seule fois par installation : les clés identifient le serveur
 * auprès des services de push, et en changer invaliderait tous les abonnements
 * déjà pris — les téléphones cesseraient silencieusement d'être notifiés.
 */
const { publicKey, privateKey } = generateVapidKeys();

process.stdout.write(
  [
    '# Clés VAPID — à conserver hors du dépôt (variables d’environnement).',
    '# Ne les changez plus : tous les abonnements en cours seraient perdus.',
    `VAPID_PUBLIC_KEY=${publicKey}`,
    `VAPID_PRIVATE_KEY=${privateKey}`,
    '# Contact de l’exploitant, exigé par VAPID.',
    'VAPID_SUBJECT=mailto:contact@example.org',
    '',
  ].join('\n'),
);
