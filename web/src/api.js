/** Appels à l'API locale. Le serveur est le seul à parler à ADE. */

/** Les deux seules routes qui écrivent : l'abonnement aux notifications. */
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
  // Les deux répondent 204 : rien à lire.
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

export const api = {
  departments: (signal) => getJson('/api/departments', signal),
  /** Arbre des groupes du département. */
  groups: (department, signal) => getJson(`/api/${seg(department)}/groups`, signal),
  /** Liste plate des salles (`rooms`) ou des enseignants (`teachers`). */
  directory: (department, kind, signal) => getJson(`/api/${seg(department)}/${seg(kind)}`, signal),
  schedule: (department, kind, resourceId, from, signal) =>
    getJson(`/api/${seg(department)}/${seg(kind)}/${seg(resourceId)}/schedule?from=${seg(from)}`, signal),
  // Le restaurant universitaire est fixé côté serveur : aucun paramètre ici.
  crousMenu: (signal) => getJson('/api/crous/menu', signal),
  calendarUrl: (department, kind, resourceId) =>
    `${location.origin}/api/${seg(department)}/${seg(kind)}/${seg(resourceId)}/calendar.ics`,

  /** Notifications push : l'installation les propose-t-elle, et sous quelle clé publique ? */
  pushConfig: (signal) => getJson('/api/push/config', signal),
  /** Enregistre ou met à jour l'abonnement de cet appareil. */
  pushSubscribe: (payload, signal) => postJson('/api/push/subscribe', payload, signal),
  pushUnsubscribe: (endpoint, signal) => postJson('/api/push/unsubscribe', { endpoint }, signal),
};
