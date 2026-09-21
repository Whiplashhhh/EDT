/** Appels à l'API locale. Le serveur est le seul à parler à ADE. */

async function getJson(path, signal) {
  const res = await fetch(path, { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Erreur ${res.status}`);
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
  calendarUrl: (department, groupId) =>
    `${location.origin}/api/${encodeURIComponent(department)}/groups/${encodeURIComponent(groupId)}/calendar.ics`,
};
