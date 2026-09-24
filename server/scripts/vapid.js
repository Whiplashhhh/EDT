import webpush from 'web-push';

/**
 * Fabrique une paire de clés VAPID pour les notifications push.
 *
 * Volontairement en JavaScript, et non en TypeScript comme le reste du
 * serveur : c'est un utilitaire qu'on lance à la main, souvent sur la machine
 * qui héberge le service, où Node n'est pas forcément assez récent pour
 * `--experimental-strip-types` (Node 22.6). Il n'a besoin de rien d'autre que
 * de `web-push`.
 *
 * À lancer une seule fois par installation : les clés identifient le serveur
 * auprès des services de push, et en changer invaliderait tous les abonnements
 * déjà pris — les téléphones cesseraient silencieusement d'être notifiés.
 */
const { publicKey, privateKey } = webpush.generateVAPIDKeys();

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
