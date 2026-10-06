/**
 * Relais vers ADE, à déployer comme Worker Cloudflare.
 *
 * Le pare-feu de l'ULCO refuse l'adresse du VPS : le serveur envoie alors ses
 * appels ici (variable ADE_RELAY_URL), et le Worker les rejoue tels quels vers
 * ADE depuis le réseau de Cloudflare. Il ne sert que ce serveur — la clé
 * RELAY_KEY, un secret du Worker, doit égaler ADE_RELAY_KEY — et que les deux
 * chemins dont l'application a besoin.
 */
const ADE = 'https://edt.univ-littoral.fr';
/** L'API GWT d'ADE, et les flux iCalendar qu'elle publie. */
const ALLOWED_PATHS = ['/direct/gwtdirectplanning/', '/jsp/custom/modules/plannings/'];
/** Ce que le serveur envoie à ADE ; le reste des en-têtes ne passe pas. */
const FORWARDED_HEADERS = ['accept', 'content-type', 'cookie', 'x-gwt-module-base', 'x-gwt-permutation'];

/** Comparaison à durée constante : la clé ne se devine pas au chronomètre. */
function sameKey(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export default {
  async fetch(request, env) {
    if (!sameKey(request.headers.get('x-relay-key'), env.RELAY_KEY)) {
      return new Response('Interdit', { status: 403 });
    }
    const url = new URL(request.url);
    if (!ALLOWED_PATHS.some((path) => url.pathname.startsWith(path))) {
      return new Response('Introuvable', { status: 404 });
    }
    if (request.method !== 'GET' && request.method !== 'POST') {
      return new Response('Méthode non autorisée', { status: 405 });
    }

    const headers = new Headers();
    for (const name of FORWARDED_HEADERS) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    // La réponse d'ADE revient telle quelle, `Set-Cookie` compris : la session GWT en dépend.
    return fetch(`${ADE}${url.pathname}${url.search}`, {
      method: request.method,
      headers,
      body: request.method === 'POST' ? await request.arrayBuffer() : undefined,
      redirect: 'manual',
    });
  },
};
