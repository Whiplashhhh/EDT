import { createECDH } from 'node:crypto';
import { pathToFileURL } from 'node:url';

/**
 * Fabrique une paire de clés VAPID pour les notifications push.
 *
 * Volontairement sans aucune dépendance, et en JavaScript simple plutôt qu'en
 * TypeScript comme le reste du serveur. C'est l'utilitaire d'amorçage : on le
 * lance sur la machine qui héberge le service, avant toute mise en service,
 * là où il n'y a souvent ni `node_modules` (le service tourne dans son
 * conteneur) ni Node assez récent pour `--experimental-strip-types`. Son
 * extension `.mjs` le rend autonome jusqu'au bout : il s'exécute même copié
 * seul, hors du dépôt et loin du `package.json` qui déclare le reste en module.
 *
 * Une clé VAPID n'est rien d'autre qu'une paire de clés sur la courbe P-256
 * (RFC 8292), telle que `node:crypto` sait la produire depuis toujours : il
 * aurait été absurde d'exiger une bibliothèque pour cela.
 *
 * À lancer une seule fois par installation : les clés identifient le serveur
 * auprès des services de push, et en changer invaliderait tous les abonnements
 * déjà pris — les téléphones cesseraient silencieusement d'être notifiés.
 */

/** Longueurs imposées par le format : point non compressé, et scalaire P-256. */
const PUBLIC_KEY_BYTES = 65;
const PRIVATE_KEY_BYTES = 32;

/**
 * Complète à gauche par des zéros. OpenSSL rend un scalaire sans ses zéros de
 * tête : une fois sur 256, la clé privée ferait 31 octets et serait refusée.
 */
function leftPad(buffer, length) {
  if (buffer.length >= length) return buffer;
  return Buffer.concat([Buffer.alloc(length - buffer.length, 0), buffer], length);
}

export function generateVapidKeys() {
  const curve = createECDH('prime256v1');
  curve.generateKeys();
  return {
    // Point non compressé : 0x04 suivi des coordonnées X et Y.
    publicKey: leftPad(curve.getPublicKey(), PUBLIC_KEY_BYTES).toString('base64url'),
    privateKey: leftPad(curve.getPrivateKey(), PRIVATE_KEY_BYTES).toString('base64url'),
  };
}

/** Lancé directement (et non importé par un test) : on écrit les lignes à recopier. */
const launchedDirectly =
  process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;

if (launchedDirectly) {
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
}
