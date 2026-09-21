/**
 * Couleur d'un cours. Elle dépend de la **ressource** (R5.A.11, R5.A.12, SAE5.A.00…),
 * jamais du type de séance : deux TP de ressources différentes doivent se distinguer,
 * et une ressource garde sa couleur toute l'année. Le type reste affiché en toutes lettres.
 */

/**
 * 12 teintes écartées de 30° × 3 tons (clair, moyen, sombre) : 36 couleurs,
 * choisies larges plutôt que nombreuses — deux ressources voisines doivent se
 * distinguer d'un coup d'œil, pas seulement au pixel près.
 */
const HUE_STEPS = 12;
const TONES = 3;

/**
 * Graine retenue parce qu'elle maximise l'écart entre les couleurs des ressources
 * réellement observées (BUT1, BUT2 et BUT3 de l'IUT informatique) : aucune collision,
 * et deux ressources partageant une teinte sont toujours séparées d'un ton entier.
 */
const SEED = 568767624;

/**
 * Code de la ressource au début de l'intitulé : « R1-06 », « R5.A.12 », « SAE5.B.00 ».
 * On s'arrête au premier mot sans chiffre, qui est le libellé (« Maths », « Appli IA »),
 * puis on retire la ponctuation. « R1-06 » et « R1-06 Maths » donnent donc la même clé,
 * tout comme « R5.02 PPP » et « R5.02.PPP », tandis que « R5.A.11 » et « R5.A.12 »
 * restent deux ressources distinctes.
 */
const CODE_RE = /^([A-Z]{1,4}\d+(?:[.\-_ ]?[A-Z]?[.\-_ ]?\d+)*)/;

function resourceKey(event) {
  const label = (event.subject || event.title || '').toUpperCase().trim();
  const code = CODE_RE.exec(label);
  // Sans code identifiable (« STAGES », « Préparation PortFolio »), l'intitulé fait office de clé.
  return (code ? code[1] : label).replace(/[^A-Z0-9]/g, '') || label;
}

/** Hachage déterministe (FNV-1a + brassage final) : même ressource ⇒ même couleur, partout. */
function hash(key) {
  let h = SEED >>> 0;
  for (let i = 0; i < key.length; i += 1) {
    h = (h ^ key.charCodeAt(i)) >>> 0;
    h = Math.imul(h, 16777619) >>> 0;
  }
  h = (h ^ (h >>> 15)) >>> 0;
  h = Math.imul(h, 2246822507) >>> 0;
  return (h ^ (h >>> 13)) >>> 0;
}

/**
 * Style à poser sur le bloc : `--kind-h` (teinte) et `--kind-t` (ton, 0 ou 1),
 * que le thème combine avec `--tint-s` / `--tint-l` pour obtenir la couleur.
 */
export function courseStyle(event) {
  const index = hash(resourceKey(event)) % (HUE_STEPS * TONES);
  return {
    '--kind-h': (index % HUE_STEPS) * (360 / HUE_STEPS),
    '--kind-t': Math.floor(index / HUE_STEPS),
  };
}
