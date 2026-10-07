/**
 * Impression depuis l'application installée sur iPhone. iOS y ignore
 * `window.print()` — et ouvre chez elle toute page du même site, où il
 * l'ignore tout autant. On photographie donc l'emploi du temps tel qu'il
 * sortirait sur papier, et on le confie à la feuille de partage, qui
 * propose « Imprimer ».
 */

/** Seul iOS, application installée, connaît `navigator.standalone`. */
export const printBlocked = navigator.standalone === true;

/*
 * Les règles `@media print` de toutes les feuilles de style, à appliquer le
 * temps de la photo : palette claire, boutons masqués, grille dépliée. Elles
 * restent écrites une seule fois, pour l'impression comme pour l'image.
 */
function printRules() {
  const out = [];
  for (const sheet of document.styleSheets) {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      // Feuille d'une autre origine : illisible, et sans règle d'impression à nous.
      continue;
    }
    for (const rule of rules) {
      if (rule instanceof CSSMediaRule && /\bprint\b/.test(rule.media.mediaText)) {
        for (const inner of rule.cssRules) out.push(inner.cssText);
      }
    }
  }
  return out.join('\n');
}

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));

/** Image PNG de `element` mis en page pour l'impression. */
export async function captureForPrint(element, name) {
  const { toBlob } = await import('html-to-image');
  const style = document.createElement('style');
  style.textContent = printRules();
  document.head.append(style);
  const previous = element.getAttribute('style');
  try {
    await nextFrame();
    // La grille, dépliée, peut déborder l'écran du téléphone : l'image s'élargit d'autant.
    const width = Math.max(element.scrollWidth, ...[...element.querySelectorAll('.scroller')].map((el) => el.scrollWidth));
    element.style.width = `${width}px`;
    element.style.maxWidth = 'none';
    element.style.minHeight = '0';
    await nextFrame();
    const options = { width, height: element.scrollHeight, pixelRatio: 2, backgroundColor: '#ffffff' };
    // Safari dessine parfois la première image à vide : la seconde est la bonne.
    await toBlob(element, options);
    const blob = await toBlob(element, options);
    return new File([blob], `${name.replace(/[\\/:*?"<>|]+/g, '-')}.png`, { type: 'image/png' });
  } finally {
    style.remove();
    if (previous === null) element.removeAttribute('style');
    else element.setAttribute('style', previous);
  }
}

/**
 * Ouvre la feuille de partage sur l'image. `false` si iOS refuse faute d'un
 * toucher assez récent — la photo a pris trop longtemps : il faut alors un
 * second toucher pour la partager.
 */
export async function shareFile(file) {
  try {
    await navigator.share({ files: [file] });
  } catch (err) {
    if (err.name === 'NotAllowedError') return false;
    // Partage annulé : rien à faire.
  }
  return true;
}
