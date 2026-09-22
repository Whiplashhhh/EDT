/** Appels à l'API locale. Le serveur est le seul à parler à ADE. */

async function getJson(path, signal) {
  const res = await fetch(path, { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    // `code` permet au front de choisir un message dans sa propre langue.
    throw Object.assign(new Error(body.error || `HTTP ${res.status}`), { code: body.code });
  }
  return res.json();
}

export const api = {
  departments: (signal) => getJson('/api/departments', signal),
  groups: (department, signal) => getJson(`/api/${encodeURIComponent(department)}/groups`, signal),
  schedule: (department, groupId, from, signal) =>
    getJson(
      `/api/${encodeURIComponent(department)}/groups/${encodeURIComponent(groupId)}/schedule?from=${encodeURIComponent(from)}`,
      signal,
    ),
  // Le restaurant universitaire est fixé côté serveur : aucun paramètre ici.
  crousMenu: (signal) => getJson('/api/crous/menu', signal),
  calendarUrl: (department, groupId) =>
    `${location.origin}/api/${encodeURIComponent(department)}/groups/${encodeURIComponent(groupId)}/calendar.ics`,
};
