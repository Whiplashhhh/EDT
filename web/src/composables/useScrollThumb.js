/**
 * Barre de défilement toujours visible pour les listes du sélecteur.
 *
 * iOS Safari (et macOS avec les barres « superposées ») n'affiche la barre de
 * défilement que pendant le geste, et ignore `::-webkit-scrollbar` : rien
 * n'indique qu'une liste continue sous le bord. On dessine donc notre propre
 * curseur, posé sur le bord droit de la liste qui défile. Là où le navigateur
 * réserve déjà une vraie barre (Chrome sur PC), on n'ajoute rien.
 */
import { onBeforeUnmount, onMounted } from 'vue';

const MIN_THUMB = 28;

/**
 * @param {import('vue').Ref<HTMLElement>} root conteneur positionné qui reçoit le curseur
 * @param {import('vue').Ref<HTMLElement>} thumb élément du curseur, enfant direct de `root`
 * @param {string} selector listes susceptibles de défiler, cherchées dans `root`
 */
export function useScrollThumb(root, thumb, selector) {
  let list = null;
  let frame = 0;
  const resize = new ResizeObserver(() => schedule());
  const mutations = new MutationObserver(() => schedule());

  function schedule() {
    if (!frame) frame = requestAnimationFrame(update);
  }

  function update() {
    frame = 0;
    const box = root.value;
    const bar = thumb.value;
    if (!box || !bar) return;
    const next = box.querySelector(selector);
    if (next !== list) {
      if (list) resize.unobserve(list);
      list = next;
      if (list) resize.observe(list);
    }
    // Une vraie barre occupe de la place : le navigateur l'affiche déjà.
    if (!list || list.offsetWidth !== list.clientWidth || list.scrollHeight <= list.clientHeight + 1) {
      bar.hidden = true;
      return;
    }
    const { scrollHeight, clientHeight, scrollTop } = list;
    const size = Math.max(MIN_THUMB, (clientHeight * clientHeight) / scrollHeight);
    const ratio = Math.min(1, Math.max(0, scrollTop / (scrollHeight - clientHeight)));
    bar.hidden = false;
    bar.style.height = `${size}px`;
    bar.style.top = `${list.offsetTop + (clientHeight - size) * ratio}px`;
    bar.style.left = `${list.offsetLeft + list.offsetWidth - bar.offsetWidth - 1}px`;
  }

  onMounted(() => {
    const box = root.value;
    // `scroll` ne remonte pas : on l'écoute en phase de capture.
    box.addEventListener('scroll', schedule, { capture: true, passive: true });
    resize.observe(box);
    mutations.observe(box, { childList: true, subtree: true });
    schedule();
  });

  onBeforeUnmount(() => {
    root.value?.removeEventListener('scroll', schedule, { capture: true });
    resize.disconnect();
    mutations.disconnect();
    cancelAnimationFrame(frame);
  });
}
