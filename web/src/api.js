/** Appels à l'API locale. Le serveur est le seul à parler à ADE. */

/** Les routes qui écrivent : l'abonnement aux notifications et le formulaire de contact. */
async function postJson(path, body, signal) {
  const res = await fetch(path, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw Object.assign(new Error(payload.error || `HTTP ${res.status}`), { code: payload.code });
  }
  // Toutes répondent 204 : rien à lire.
}

async function getJson(path, signal) {
  const res = await fetch(path, { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    // `code` permet au front de choisir un message dans sa propre langue.
    throw Object.assign(new Error(body.error || `HTTP ${res.status}`), { code: body.code });
  }
  return res.json();
}

const seg = encodeURIComponent;
/** Une ressource, ou une sélection de ressources (`12,34-0`) : virgules et tirets restent lisibles. */
const ids = (resourceId) => String(resourceId).split(',').map(seg).join(',');

export const api = {
  departments: (signal) => getJson('/api/departments', signal),
  /** Arbre des groupes du département. */
  groups: (department, signal) => getJson(`/api/${seg(department)}/groups`, signal),
  /** Liste plate des salles (`rooms`), des enseignants (`teachers`) ou des ressources (`subjects`). */
  directory: (department, kind, signal) => getJson(`/api/${seg(department)}/${seg(kind)}`, signal),
  schedule: (department, kind, resourceId, from, signal) =>
    getJson(`/api/${seg(department)}/${seg(kind)}/${ids(resourceId)}/schedule?from=${seg(from)}`, signal),
  // Le restaurant suit le campus de la formation : on donne la formation, le serveur choisit.
  crousMenu: (department, signal) =>
    getJson(department ? `/api/crous/menu?department=${seg(department)}` : '/api/crous/menu', signal),
  calendarUrl: (department, kind, resourceId) =>
    `${location.origin}/api/${seg(department)}/${seg(kind)}/${ids(resourceId)}/calendar.ics`,

  /** Notifications push : l'installation les propose-t-elle, et sous quelle clé publique ? */
  pushConfig: (signal) => getJson('/api/push/config', signal),
  /** Enregistre ou met à jour l'abonnement de cet appareil. */
  pushSubscribe: (payload, signal) => postJson('/api/push/subscribe', payload, signal),
  pushUnsubscribe: (endpoint, signal) => postJson('/api/push/unsubscribe', { endpoint }, signal),

  /** Le serveur sait-il transmettre un message ? Sans SMTP, le formulaire reste caché. */
  feedbackConfig: (signal) => getJson('/api/feedback/config', signal),
  /** Contact, suggestion ou problème : le serveur le relaie par courriel. */
  sendFeedback: (payload, signal) => postJson('/api/feedback', payload, signal),
};
