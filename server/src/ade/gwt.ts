/**
 * Client GWT-RPC minimal pour ADE Campus 6.13 (module "direct planning").
 *
 * ADE n'expose pas d'API publique : le client officiel est une application GWT
 * qui parle un protocole RPC textuel. On réimplémente ici le strict nécessaire :
 *   login → loadProject → getChildren (arbre des groupes) → getGeneratedUrl (flux ICS).
 *
 * Aucune donnée personnelle ne transite : le jeton `data` d'un lien ADE public
 * identifie une *publication* (ex. « étudiants IUT info »), pas un utilisateur.
 */

const GWT_BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789$_';

/** Encode un entier 64 bits positif dans le base64 « maison » de GWT. */
export function encodeGwtLong(value: number): string {
  if (!Number.isFinite(value) || value < 0) throw new RangeError('long GWT invalide');
  let rest = Math.trunc(value);
  let out = '';
  do {
    out = GWT_BASE64[rest % 64] + out;
    rest = Math.floor(rest / 64);
  } while (rest > 0);
  return out;
}

/** Minuit, heure de Paris, pour une date ISO `YYYY-MM-DD` — comme le fait le client ADE. */
export function parisMidnight(isoDate: string): number {
  const [y, m, d] = isoDate.split('-').map(Number);
  // On cherche l'instant UTC dont la représentation à Paris est YYYY-MM-DDT00:00.
  const guess = Date.UTC(y, m - 1, d);
  const offset = parisOffsetMinutes(guess);
  return guess - offset * 60_000;
}

function parisOffsetMinutes(utcMs: number): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Paris',
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = Object.fromEntries(fmt.formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return Math.round((asUtc - utcMs) / 60_000);
}

export interface AdeResource {
  /** Identifiant ADE de la ressource (stable d'une session à l'autre). */
  id: number;
  name: string;
  /** Chemin hiérarchique ADE, ex. « IUT INFO.BUT1.BUT1-TD1 ». */
  path: string;
  children: AdeResource[];
}

export interface AdeClientOptions {
  /** Origine du serveur ADE, ex. https://edt.univ-littoral.fr */
  origin: string;
  /** Jeton `data=` d'un lien ADE « direct planning » public. */
  token: string;
  /** Identifiant du projet ADE (année universitaire). */
  projectId: number;
  /** Délai maximum par requête, en ms. */
  timeoutMs?: number;
}

const STRONG_NAME_DIRECT = '067818807965393FC5DCF6AECC2CA8EC';
const STRONG_NAME_CORE = '748880AB5D6D59CC4770FCCE7567EA63';
const IFACE_DIRECT = 'com.adesoft.gwt.directplan.client.rpc.DirectPlanningServiceProxy';
const IFACE_CORE = 'com.adesoft.gwt.core.client.rpc.CorePlanningServiceProxy';

export class AdeError extends Error {}

/**
 * Session ADE. Une instance = un JSESSIONID côté serveur ADE ; elle est
 * volontairement à durée de vie courte (on l'ouvre, on lit, on la jette).
 */
export class AdeClient {
  readonly #opts: Required<AdeClientOptions>;
  readonly #moduleBase: string;
  readonly #clientStamp: string;
  #cookie = '';

  constructor(opts: AdeClientOptions) {
    this.#opts = { timeoutMs: 15_000, ...opts };
    this.#moduleBase = `${opts.origin}/direct/gwtdirectplanning/`;
    this.#clientStamp = encodeGwtLong(Date.now());
  }

  async #rpc(service: string, strongName: string, body: string): Promise<string> {
    const payload = `7|0|${body}`;
    const res = await fetch(`${this.#moduleBase}${service}`, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(this.#opts.timeoutMs),
      headers: {
        'Content-Type': 'text/x-gwt-rpc; charset=UTF-8',
        'X-GWT-Module-Base': this.#moduleBase,
        'X-GWT-Permutation': strongName,
        ...(this.#cookie ? { Cookie: this.#cookie } : {}),
      },
      body: payload,
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      const jsession = /JSESSIONID=([^;]+)/.exec(setCookie);
      if (jsession) this.#cookie = `JSESSIONID=${jsession[1]}`;
    }
    const text = await res.text();
    if (!res.ok) throw new AdeError(`ADE ${service} a répondu ${res.status}`);
    if (!text.startsWith('//OK')) throw new AdeError(`ADE ${service} a échoué : ${text.slice(0, 200)}`);
    return text;
  }

  /** Ouvre la session ADE à partir du jeton public et charge le projet. */
  async connect(): Promise<void> {
    const b = this.#moduleBase;
    await this.#rpc(
      'DirectPlanningServiceProxy',
      STRONG_NAME_DIRECT,
      `10|${b}|${STRONG_NAME_DIRECT}|${IFACE_DIRECT}|method1login|J|` +
        'com.adesoft.gwt.core.client.rpc.data.LoginRequest/3705388826|Z|' +
        `com.adesoft.gwt.directplan.client.rpc.data.DirectLoginRequest/635437471|${this.#opts.token}|` +
        `|1|2|3|4|3|5|6|7|${this.#clientStamp}|8|0|9|0|0|0|10|10|-1|0|0|0|`,
    );
    await this.#rpc(
      'DirectPlanningServiceProxy',
      STRONG_NAME_DIRECT,
      `7|${b}|${STRONG_NAME_DIRECT}|${IFACE_DIRECT}|method13loadProject|J|I|Z|1|2|3|4|3|5|6|7|` +
        `${this.#clientStamp}|${this.#opts.projectId}|1|`,
    );
  }

  /**
   * Enfants directs d'un nœud de l'arbre des ressources.
   * `parent.id === -1` désigne la racine (le dossier « Trainees »).
   */
  async children(parent: { id: number; name?: string; path?: string; depth?: number }): Promise<AdeResource[]> {
    const b = this.#moduleBase;
    const depth = parent.depth ?? 0;
    const name = escapeAdeField(parent.name ?? 'Trainees');
    const path = escapeAdeField(parent.path ?? '');
    // Un nœud racine n'a qu'un champ (le nom) ; les autres portent aussi leur couleur.
    const fields =
      depth === 0
        ? `[1]{"StringField""NAME""LabelName""${name}""false""false""${path}""trainee""1""0"[0][0]`
        : `[2]{"ColorField""COLOR""LabelColor""255,255,255""false""false"` +
          `{"StringField""NAME""LabelName""${name}""false""false""${path}""trainee""1""0"[0][0]`;
    const node = `{"${parent.id}""true""${depth}""-1""0""0""0""false"${fields}`;
    const text = await this.#rpc(
      'DirectPlanningServiceProxy',
      STRONG_NAME_DIRECT,
      `20|${b}|${STRONG_NAME_DIRECT}|${IFACE_DIRECT}|method4getChildren|J|java.lang.String/2004016611|` +
        `com.adesoft.gwt.directplan.client.ui.tree.TreeResourceConfig/2234901663|${node}|` +
        '[I/2970817851|java.util.LinkedHashMap/3008245022|COLOR|' +
        'com.adesoft.gwt.core.client.rpc.config.OutputField/870745015|LabelColor||' +
        'com.adesoft.gwt.core.client.rpc.config.FieldType/1797283245|NAME|LabelName|' +
        'java.util.ArrayList/4159755760|com.extjs.gxt.ui.client.data.SortInfo/1143517771|' +
        'com.extjs.gxt.ui.client.Style$SortDir/3873584144|' +
        `1|2|3|4|3|5|6|7|${this.#clientStamp}|8|7|0|9|2|-1|-1|10|0|2|6|11|12|0|13|11|14|15|11|0|0|6|16|12|0|17|16|14|15|4|0|0|18|0|18|0|19|20|1|16|18|0|`,
    );
    return parseChildren(text);
  }

  /**
   * Demande à ADE une URL de flux iCalendar permanente pour une ressource.
   * ADE la publie sous `/jsp/custom/modules/plannings/<id>.shu` ; elle reste
   * valable ensuite sans session, ce qui permet de la mettre en cache.
   */
  async icsUrl(resourceId: number, from: string, to: string): Promise<string> {
    const b = this.#moduleBase;
    const text = await this.#rpc(
      'CorePlanningServiceProxy',
      STRONG_NAME_CORE,
      `11|${b}|${STRONG_NAME_CORE}|${IFACE_CORE}|method11getGeneratedUrl|J|java.util.List|` +
        'java.lang.String/2004016611|java.util.Date/3385151746|java.lang.Integer/3438268394|' +
        'java.util.ArrayList/4159755760|ical|' +
        `1|2|3|4|7|5|6|7|8|8|9|9|${this.#clientStamp}|10|1|9|${resourceId}|11|` +
        `8|${encodeGwtLong(parisMidnight(from))}|8|${encodeGwtLong(parisMidnight(to))}|` +
        `9|${this.#opts.projectId}|9|23|`,
    );
    const url = /\["(https?:\/\/[^"]+)"\]/.exec(text)?.[1];
    if (!url) throw new AdeError("ADE n'a pas renvoyé d'URL iCalendar");
    if (!url.startsWith(`${this.#opts.origin}/`)) throw new AdeError('URL iCalendar hors du domaine ADE attendu');
    return url;
  }
}

/** Les champs ADE sont délimités par des guillemets : on les neutralise. */
function escapeAdeField(value: string): string {
  return value.replace(/["|\\]/g, '');
}

/**
 * Extrait les nœuds d'une réponse `getChildren`.
 * Format ADE : `{"<id>""<visible>""<depth>""<nbChildren>"…[n]{"ColorField"…{"StringField""NAME""LabelName""<nom>"…"<chemin>"…`
 */
function parseChildren(response: string): AdeResource[] {
  // La charge utile est une chaîne JSON échappée dans le tableau de réponse.
  const raw = response.replace(/\\"/g, '"');
  const out: AdeResource[] = [];
  const nodeRe = /\{"(-?\d+)""(?:true|false)""(\d+)""(-?\d+)"/g;
  const nodes: Array<{ id: number; childCount: number; at: number }> = [];
  for (let m = nodeRe.exec(raw); m; m = nodeRe.exec(raw)) {
    nodes.push({ id: Number(m[1]), childCount: Number(m[3]), at: m.index });
  }
  // Le premier nœud est le parent interrogé : on ne garde que ses enfants.
  for (const node of nodes.slice(1)) {
    const slice = raw.slice(node.at, node.at + 600);
    const label = /\{"StringField""NAME""LabelName""([^"]*)""(?:true|false)""(?:true|false)""([^"]*)"/.exec(slice);
    if (!label) continue;
    out.push({ id: node.id, name: label[1], path: label[2] || label[1], children: [] });
  }
  return out;
}
