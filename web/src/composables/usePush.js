import { ref } from 'vue';
import { api } from '../api.js';

/**
 * Notifications push, côté navigateur.
 *
 * Trois consentements doivent être réunis, et n'importe lequel peut manquer :
 * le navigateur doit savoir faire (Safari &lt; 16.4, navigation privée…),
 * le serveur doit avoir des clés VAPID, et l'utilisateur doit avoir autorisé
 * les notifications. Tant que ce n'est pas le cas, les réglages restent
 * visibles mais inertes : mieux vaut un interrupteur qui explique pourquoi il
 * ne marche pas qu'un réglage qui disparaît sans rien dire.
 *
 * L'abonnement est renvoyé au serveur à chaque ouverture de l'application.
 * C'est volontaire : c'est ainsi que suivent un changement de classe, de
 * langue ou d'options, sans mécanisme de synchronisation à part.
 */

/**
 * Brave, sur ordinateur, coupe par défaut le service de push : le réglage
 * « Use Google services for push messaging » est éteint tant qu'on ne l'allume
 * pas. L'autorisation d'afficher des notifications est bien accordée — c'est
 * l'abonnement lui-même que le navigateur refuse, sans raison lisible. Sur
 * téléphone, Brave passe par les services Google déjà présents et cela marche
 * sans rien régler : l'échec n'arrive donc que sur ordinateur.
 *
 * Brave se déclare lui-même par cette API, la seule façon fiable de le
 * reconnaître : sa signature de navigateur est volontairement celle de Chrome.
 */
async function isBrave() {
  try {
    return (await navigator.brave?.isBrave?.()) === true;
  } catch {
    return false;
  }
}

/** La clé publique VAPID voyage en base64url ; `subscribe` veut des octets. */
function decodeKey(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normalized);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

export function usePush() {
  /** Le navigateur sait-il recevoir des notifications push ? */
  const supported = ref(
    typeof window !== 'undefined' &&
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window,
  );
  /** Le serveur propose-t-il des notifications (clés VAPID configurées) ? */
  const available = ref(false);
  const permission = ref(supported.value ? Notification.permission : 'denied');
  const busy = ref(false);
  /** Clé d'un message d'erreur traduisible, ou `null`. */
  const error = ref(null);

  let publicKey = null;
  let configLoaded = null;

  async function loadConfig() {
    if (!supported.value) return false;
    configLoaded ??= api
      .pushConfig()
      .then((config) => {
        available.value = Boolean(config.enabled && config.publicKey);
        publicKey = config.publicKey ?? null;
        return available.value;
      })
      .catch(() => {
        // Serveur injoignable : on retentera à la prochaine ouverture.
        configLoaded = null;
        return false;
      });
    return configLoaded;
  }

  async function registration() {
    // `ready` attend l'activation : s'abonner avant ne servirait à rien.
    return navigator.serviceWorker.ready;
  }

  /**
   * S'abonne auprès du service de push du navigateur.
   *
   * Un abonnement déjà pris sous une autre clé publique — serveur réinstallé,
   * clés régénérées — fait échouer `subscribe`. On le jette alors et on
   * recommence, plutôt que de rester muet pour toujours.
   */
  async function browserSubscription(reg) {
    const applicationServerKey = decodeKey(publicKey);
    const existing = await reg.pushManager.getSubscription();
    if (existing) {
      try {
        return await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
      } catch {
        await existing.unsubscribe();
      }
    }
    return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
  }

  /**
   * Aligne l'état du navigateur et du serveur sur les réglages voulus.
   *
   * @param identity classe ou enseignant que l'on suit
   * @param options `{ nextCourse, changes }`
   * @param lang langue des notifications
   * @returns `true` si l'état voulu est atteint
   */
  async function sync(identity, options, lang) {
    error.value = null;
    if (!supported.value) {
      if (options.nextCourse || options.changes) error.value = 'push.unsupported';
      return false;
    }
    if (!(await loadConfig())) {
      if (options.nextCourse || options.changes) error.value = 'push.unavailable';
      return false;
    }

    const wanted = Boolean(identity) && (options.nextCourse || options.changes);
    busy.value = true;
    try {
      const reg = await registration();

      if (!wanted) {
        const existing = await reg.pushManager.getSubscription();
        if (existing) {
          // Le serveur d'abord : s'il refuse, on garde l'abonnement pour réessayer.
          await api.pushUnsubscribe(existing.endpoint).catch(() => {});
          await existing.unsubscribe();
        }
        return true;
      }

      if (permission.value !== 'granted') {
        permission.value = await Notification.requestPermission();
        if (permission.value !== 'granted') {
          error.value = 'push.denied';
          return false;
        }
      }

      /*
       * L'abonnement est isolé du reste : c'est là que se manifeste un
       * navigateur qui refuse le service de push, et le dire précisément
       * évite à l'utilisateur de chercher la panne de notre côté.
       */
      let subscription;
      try {
        subscription = (await browserSubscription(reg)).toJSON();
      } catch (err) {
        error.value = (await isBrave()) ? 'push.brave' : 'push.failed';
        return false;
      }

      await api.pushSubscribe({
        subscription,
        department: identity.department,
        kind: identity.kind,
        resourceId: identity.resourceId,
        nextCourse: options.nextCourse,
        changes: options.changes,
        lang,
      });
      return true;
    } catch (err) {
      error.value = err?.code === 'push-disabled' ? 'push.unavailable' : 'push.failed';
      return false;
    } finally {
      busy.value = false;
    }
  }

  return { supported, available, permission, busy, error, loadConfig, sync };
}
