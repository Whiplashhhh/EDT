/**
 * Service worker minimal : coquille de l'application en cache pour un démarrage
 * instantané et un affichage hors ligne. Les données ADE ne sont jamais mises en
 * cache ici — le composant `useSchedule` s'en charge via localStorage.
 */
const SHELL = 'edt-shell-v2';
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

/**
 * Notifications push.
 *
 * Le service worker est réveillé par le système même quand l'application est
 * fermée : c'est le seul endroit d'où une notification peut être affichée. Le
 * serveur envoie déjà le texte tout prêt, dans la langue de l'abonné — à cet
 * instant, la page n'est pas ouverte et rien ne pourrait le traduire ici.
 */
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    // Charge utile illisible : on préfère une notification vide et honnête à rien du tout.
  }

  const title = payload.title || 'EDT';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || '',
      // Une notification qui en remplace une autre porte la même étiquette.
      tag: payload.tag || 'edt',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      // Le jour concerné voyage avec la notification : c'est lui qu'on ouvrira au clic.
      data: { day: payload.day || null },
    }),
  );
});

/**
 * Au clic : on réutilise l'onglet déjà ouvert plutôt que d'en empiler un
 * nouveau, et on l'amène sur le jour concerné.
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const day = event.notification.data && event.notification.data.day;
  const url = day ? `/?day=${day}` : '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        // La page écoute ce message et se déplace sur le jour sans recharger.
        client.postMessage({ type: 'show-day', day });
        return client.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});

/**
 * Le service de push peut renouveler un abonnement de sa propre initiative.
 * On ne peut pas le réenregistrer d'ici sans la clé publique et l'identité :
 * on se contente de prévenir la page, qui refera l'abonnement à sa prochaine
 * ouverture.
 */
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) client.postMessage({ type: 'push-subscription-changed' });
    }),
  );
});
