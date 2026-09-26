/**
 * Sigle court d'une formation, tiré de son identifiant : `iut-info` → `INFO`.
 * Sert de pastille sur les vues transversales (salle, enseignant), où les cours
 * de plusieurs départements se côtoient.
 */
export function departmentTag(id) {
  return id ? id.split('-').pop().toUpperCase() : '';
}
