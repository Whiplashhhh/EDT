import { ref } from 'vue';

/*
 * Fiche d'un cours, ouverte en touchant sa carte — vue jour comme vue semaine.
 * Un seul état pour toute la page : les cartes l'ouvrent, l'application la
 * dessine par-dessus le reste et la referme.
 */

/** Cours affiché et ce qu'on consultait en le touchant, ou `null` si la fiche est fermée. */
const opened = ref(null);

export function useEventDetail() {
  return {
    opened,
    openDetail: (event, context = 'groups') => { opened.value = { event, context }; },
    closeDetail: () => { opened.value = null; },
  };
}
