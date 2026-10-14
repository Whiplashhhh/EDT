import type { FastifyInstance } from 'fastify';
import type { MoveConfig } from './config.ts';

/** Paramètre ajouté aux pages redirigées : l'application y reconnaît un ancien visiteur. */
export const MOVED_PARAM = 'demenage';

/** Vrai pour une requête arrivée par un ancien nom de domaine. */
export function viaOldHost(move: MoveConfig | null, hostname: string): boolean {
  return Boolean(move?.from.includes(hostname.toLowerCase()));
}

/** Les flux iCalendar restent servis sur l'ancien domaine, avec un avertissement. */
function isCalendarFeed(path: string): boolean {
  return path.startsWith('/api/') && path.endsWith('.ics');
}

/** Une page, et non un fichier ni un appel d'API : seule elle reçoit le paramètre. */
function isPage(path: string): boolean {
  return !path.startsWith('/api/') && !/\.[a-z0-9]+$/i.test(path);
}

/** Même chemin, même requête, sur la nouvelle adresse. */
export function movedUrl(move: MoveConfig, url: string): string {
  const at = url.indexOf('?');
  const path = at < 0 ? url : url.slice(0, at);
  const query = at < 0 ? '' : url.slice(at + 1);
  if (!isPage(path)) return `${move.to}${url}`;
  return `${move.to}${path}?${query ? `${query}&` : ''}${MOVED_PARAM}=1`;
}

/**
 * Renvoie tout ce qui arrive par l'ancien domaine vers le nouveau, en 301 :
 * les moteurs de recherche y transfèrent le référencement, les favoris et les
 * applications installées suivent d'eux-mêmes.
 */
export function registerMove(app: FastifyInstance, move: MoveConfig | null): void {
  if (!move) return;
  app.addHook('onRequest', async (req, reply) => {
    if (!viaOldHost(move, req.hostname)) return;
    if (isCalendarFeed(req.url.split('?')[0] ?? '')) return;
    return reply.redirect(movedUrl(move, req.url), 301);
  });
}
