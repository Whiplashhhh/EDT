import { computed, ref } from 'vue';

/*
 * Installation sur l'écran d'accueil. Chaque navigateur a sa façon de faire :
 *
 * - Chrome, Edge, Samsung Internet et Opera sur Android annoncent qu'ils
 *   savent installer le site (`beforeinstallprompt`) et laissent la page ouvrir
 *   leur propre fenêtre d'installation. C'est le seul cas où un bouton peut
 *   faire le travail lui-même. Déjà installé, le site ne reçoit plus
 *   l'événement : le bouton disparaît de lui-même.
 * - Sur iPhone et iPad, aucun navigateur ne laisse une page ouvrir le menu
 *   Partager. Le bouton ne peut qu'expliquer les deux gestes à faire.
 * - Firefox sur Android n'a pas d'API non plus : même traitement.
 *
 * Ni iOS ni Firefox ne disent à la page qu'elle a été installée. C'est donc
 * l'utilisateur qui le dit (« C'est fait »), et on s'en souvient.
 */

const DONE_KEY = 'edt.installed';

function readDone() {
  try {
    return localStorage.getItem(DONE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeDone() {
  try {
    localStorage.setItem(DONE_KEY, '1');
  } catch {
    // Stockage indisponible (navigation privée) : le bouton reviendra, sans plus.
  }
}

const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
// L'iPad se présente comme un Mac depuis iPadOS 13 : seul l'écran tactile le trahit.
const isIos = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
const isAndroidFirefox = /Android/.test(ua) && /Firefox/.test(ua);

/** Ouvert depuis l'écran d'accueil : il n'y a plus rien à installer. */
function runsStandalone() {
  return (
    typeof window !== 'undefined' &&
    (window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true)
  );
}

/*
 * L'événement peut tomber avant le montage de l'application : on l'écoute dès
 * le chargement du module, et l'état est partagé par tous ceux qui l'utilisent.
 */
const deferredPrompt = ref(null);
const done = ref(readDone() || runsStandalone());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    // Sans cela, Chrome afficherait sa propre bannière, à un moment de son choix.
    event.preventDefault();
    deferredPrompt.value = event;
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt.value = null;
    done.value = true;
    writeDone();
  });
}

export function useInstall() {
  /** « prompt » : le navigateur installe ; « ios » / « firefox » : on explique. */
  const mode = computed(() => {
    if (done.value) return null;
    if (deferredPrompt.value) return 'prompt';
    if (isIos) return 'ios';
    if (isAndroidFirefox) return 'firefox';
    return null;
  });

  const guideOpen = ref(false);

  async function install() {
    if (mode.value !== 'prompt') {
      guideOpen.value = true;
      return;
    }
    const event = deferredPrompt.value;
    // Un événement ne sert qu'une fois, accepté ou non.
    deferredPrompt.value = null;
    await event.prompt();
    const { outcome } = await event.userChoice;
    if (outcome === 'accepted') {
      done.value = true;
      writeDone();
    }
  }

  /** L'utilisateur confirme avoir ajouté l'icône : le bouton ne revient plus. */
  function markDone() {
    done.value = true;
    guideOpen.value = false;
    writeDone();
  }

  return { mode, guideOpen, install, markDone };
}
