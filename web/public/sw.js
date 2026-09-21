/**
 * Service worker minimal : coquille de l'application en cache pour un démarrage
 * instantané et un affichage hors ligne. Les données ADE ne sont jamais mises en
 * cache ici — le composant `useSchedule` s'en charge via localStorage.
 */
const SHELL = 'edt-shell-v1';
const SHELL_URLS = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll(SHELL_URLS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // L'API doit toujours être fraîche : pas d'interception.
  if (url.pathname.startsWith('/api/')) return;

  // Navigation : réseau d'abord, coquille en secours hors ligne.
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('/index.html')));
    return;
  }

  // Ressources compilées : cache d'abord, elles portent une empreinte dans leur nom.
  event.respondWith(
    caches.match(request).then((hit) =>
      hit ||
      fetch(request).then((res) => {
        if (res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(SHELL).then((cache) => cache.put(request, copy));
        }
        return res;
      }),
    ),
  );
});
