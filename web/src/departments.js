/**
 * Sigle court d'une formation, tiré de son identifiant. Sert de pastille sur
 * les vues transversales (salle, enseignant), où les cours de plusieurs
 * formations se côtoient. Un département d'IUT se reconnaît à sa spécialité
 * (`iut-info` → `INFO`) ; les autres composantes à leur nom
 * (`eilco-calais` → `EILCO`, `cgu-st-omer` → `CGU`).
 */
export function departmentTag(id) {
  if (!id) return '';
  const [head, ...rest] = id.split('-');
  return (head === 'iut' && rest.length ? rest.join('-') : head).toUpperCase();
}
