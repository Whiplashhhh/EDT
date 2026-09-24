# EDT ULCO

Emploi du temps de l'ULCO, lisible sur téléphone.

L'application officielle (ADE Campus 6.13) est un client GWT de 2011 : elle n'est pas
responsive et demande à chaque ouverture de choisir le projet, puis de déplier l'arbre
des groupes, puis la semaine. Ce projet fait la même chose en une ouverture : on choisit
sa classe une fois, elle est mémorisée, et l'emploi du temps du jour s'affiche.

- **Pas de compte**, pas de mot de passe, pas de cookie, pas de suivi.
- La classe choisie est enregistrée en `localStorage`, uniquement sur l'appareil.
- Installable sur l'écran d'accueil (PWA) et consultable hors ligne (dernières données vues).
- Abonnement possible depuis l'app Calendrier du téléphone (flux `.ics`).
- Notifications facultatives : prochain cours, changements d’aujourd’hui et de demain, menu du midi.

## Architecture

```
navigateur ──► serveur Node (Fastify) ──► ADE Campus (edt.univ-littoral.fr)
   Vue 3          API JSON + cache            GWT-RPC puis flux iCalendar
```

Le serveur est le seul à parler à ADE. Deux raisons :

1. ADE n'envoie aucun en-tête CORS : un navigateur ne peut pas l'appeler directement.
2. Le jeton du lien ADE public ne doit pas se retrouver dans le code de la page.

### Comment les données sont obtenues

ADE n'a pas d'API publique. Le serveur rejoue le dialogue du client officiel :

| Étape | Appel | Résultat |
|---|---|---|
| 1 | `DirectPlanningServiceProxy.login` (jeton `data=` du lien public) | session ADE |
| 2 | `DirectPlanningServiceProxy.loadProject` | année universitaire ouverte |
| 3 | `DirectPlanningServiceProxy.getChildren` (récursif) | arbre des groupes et leurs identifiants |
| 4 | `CorePlanningServiceProxy.getGeneratedUrl` | URL `.shu` de flux iCalendar, stable et publique |
| 5 | `GET <url>.shu?firstDate=AAAA-MM-JJ` | fenêtre d'environ douze semaines de cours |

L'étape 4 renvoie toujours la même URL pour une ressource donnée : elle est mise en cache
24 h. L'arbre des groupes est mis en cache 12 h, les emplois du temps 10 minutes.

> ADE ignore `lastDate` et `nbWeeks` sur ces flux ; seul `firstDate` est pris en compte,
> la fenêtre servie fait toujours ~12 semaines. L'application recharge donc uniquement
> quand on navigue en dehors de la fenêtre déjà en mémoire.

## Démarrage

```bash
npm install
npm run build          # compile le front dans web/dist
npm start              # http://localhost:3000
```

En développement, deux processus avec rechargement à chaud :

```bash
npm run dev --workspace=server   # API sur :3000
npm run dev --workspace=web      # front sur :5173, proxy /api vers :3000
```

Tests :

```bash
npm test
```

## Configuration

`server/config/departments.json` liste les sources ADE. Une entrée = un lien ADE
« direct planning » public :

```json
{
  "id": "iut-info",
  "label": "IUT Informatique",
  "origin": "https://edt.univ-littoral.fr",
  "projectId": 5,
  "token": "6b052c86…"
}
```

Pour ajouter une formation, il suffit de récupérer son lien ADE public et d'en extraire
le paramètre `data=`. Le jeton peut rester hors du dépôt via la variable d'environnement
`ADE_TOKEN_<ID>` (ex. `ADE_TOKEN_IUT_INFO`), qui a la priorité sur le fichier.

Le menu du midi vient de l'API publique [CROUStillant](https://croustillant.menu), qui
republie les menus du réseau Crous. Un seul restaurant est affiché — celui du campus,
`CROUS_RESTAURANT_ID` (1164 = R.U. de la Mi-Voix, Calais) — et l'application ne propose
pas d'en changer. Il apparaît dans la vue jour, calé sur le service de 11 h 15 à 13 h 45 :
dans le trou entre deux cours qui recouvre le service, sinon avant un premier cours qui
commence après 11 h 15, sinon après un dernier cours qui finit avant 13 h 45.

Côté navigateur, le thème (système / clair / sombre) et la langue se règlent dans
le menu ⋯ et sont mémorisés sur l'appareil. À la première visite, la langue est
celle du navigateur — donc, en général, celle du système — si elle figure parmi
les traductions ; sinon l'anglais, plus partagé que le français chez ceux qui ne
lisent ni l'un ni l'autre. L'interface se décline en
quarante-cinq langues, groupées par région dans la liste déroulante : la liste
et les réglages associés (étiquette Intl pour les dates, sens d'écriture) vivent
dans `web/src/i18n.js`, un catalogue de textes par langue dans
`web/src/locales/`. Le français et l'anglais sont dans le bundle, les autres se
téléchargent au premier usage puis restent en cache. Ce qui vient d'ADE ou du
Crous (intitulés de cours, plats) n'est pas traduit, ce sont des données — et
les notifications push, composées par le serveur, restent en français ou en
anglais (`server/src/push/messages.ts`) : qui ne lit pas le français les reçoit
en anglais.

Les autres réglages sont dans `.env.example`.

## API

| Route | Description |
|---|---|
| `GET /api/health` | état du service |
| `GET /api/crous/menu` | menu du restaurant universitaire (jours à venir) |
| `GET /api/departments` | formations disponibles |
| `GET /api/:dept/groups` | arbre des groupes |
| `GET /api/:dept/groups/:id/schedule?from=AAAA-MM-JJ` | cours normalisés en JSON |
| `GET /api/:dept/groups/:id/calendar.ics` | flux iCalendar à ajouter à son calendrier |
| `GET /api/:dept/rooms` · `GET /api/:dept/teachers` | annuaire des salles, des enseignants |
| `GET /api/:dept/:kind/:id/schedule` · `/calendar.ics` | même chose pour une salle, un enseignant |
| `GET /api/push/config` | notifications proposées ? clé publique VAPID |
| `POST /api/push/subscribe` | enregistre ou met à jour l'abonnement d'un appareil |
| `POST /api/push/unsubscribe` | supprime l'abonnement d'un appareil |

`:dept` vaut `all` pour les salles et les enseignants : une salle est partagée
par tout l'établissement, un enseignant intervient souvent dans plusieurs
formations. Les chercher formation par formation ferait passer une salle pour
libre alors qu'un autre département l'occupe. Chaque cours retient d'où il vient,
car les formations n'ont pas la même grille horaire (voir `ade/slots.ts`) : dans
une telle vue, chacun est recalé sur la sienne.

## Identité et notifications

### Se définir une fois

À la première ouverture, l'application demande **qui l'on est** : sa classe, ou
son nom si l'on enseigne — certains enseignants utilisent l'application, et il
n'y aurait aucun sens à leur faire choisir une classe. Tant que ce choix n'est
pas fait, il n'y a rien à afficher : l'écran est bloquant.

Ce choix n'empêche rien. On peut ensuite consulter l'emploi du temps d'une autre
classe, d'un enseignant ou d'une salle : l'identité reste mémorisée, et un
bouton dans l'en-tête ramène d'un geste à son propre emploi du temps. Elle se
change à tout moment depuis le menu ⋯.

L'identité est distincte de la ressource affichée, et c'est elle — et elle
seule — qui décide des notifications reçues : aller regarder l'emploi du temps
du voisin ne doit pas changer les cours dont on est prévenu.

### Les trois notifications

Elles sont **éteintes par défaut** et s'activent séparément dans le menu ⋯.

**Prochain cours.** Un cours enchaîné derrière un autre est annoncé 5 minutes
avant la fin de celui-ci — on est alors encore en cours, et c'est le moment utile
pour savoir où aller en sortant. Un cours qu'une vraie pause précède — le premier
de la journée, la reprise de l'après-midi, le retour après un trou — est annoncé
30 minutes avant son début : l'annoncer dès la fin du cours d'avant le ferait
passer pour imminent alors qu'il reste une heure à attendre.

Les horaires employés sont ceux de la grille du département, et non les blocs
publiés par ADE : au BUT INFO, le cours de 11 h 35 est annoncé à 11 h 30, quand
le précédent s'achève réellement, et non à 11 h 25.

**Menu du midi.** Le menu du restaurant universitaire, 5 minutes avant la fin du
dernier cours d'avant la pause — celui qui s'achève dans la fenêtre de midi. Les
jours de fermeture, la notification le dit ; si le Crous ne publie rien ou ne
répond pas, elle le dit aussi, plutôt que de laisser attendre un menu qui ne
viendra pas. Une journée qui ne commence qu'à 14 h n'annonce rien : on n'y
déjeune pas entre deux cours.

**Changements.** Salle, horaire, intervenant, cours ajouté ou annulé : les
abonnés de la classe concernée sont prévenus, mais **uniquement pour les cours
d'ici la fin de la journée de demain**. Au-delà, un réaménagement se découvre
en ouvrant l'application plutôt qu'en faisant sonner un téléphone.

### Mise en service

Les notifications restent éteintes tant que le serveur n'a pas de clés VAPID :
les routes d'abonnement répondent 503 et l'application ne propose pas les
réglages. Pour les activer, générer une paire **une seule fois** :

```bash
npm run vapid --workspace=server
```

C'est l'utilitaire d'amorçage, et le seul fichier du projet à n'avoir ni
dépendance ni TypeScript : une clé VAPID est une simple paire de clés P-256
que `node:crypto` produit tout seul. Il tourne donc sur la machine
d'hébergement telle quelle — sans `npm install`, et sans le Node 22.6 qu'exige
le `--experimental-strip-types` du reste du serveur. Au besoin, directement :

```bash
node server/scripts/vapid.mjs
```

Puis reporter `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` et `VAPID_SUBJECT` dans
l'environnement — un fichier `.env` à côté de `compose.yaml`, que le service
lit déjà et que `.gitignore` tient hors du dépôt. **Ne plus en changer
ensuite** : les abonnements en cours seraient invalidés et les téléphones
cesseraient d'être prévenus sans rien signaler.

### Ce qui est conservé

C'est la seule entorse au « rien sur disque ». Un abonnement push ne se
recalcule pas : le navigateur ne le donne qu'une fois, à l'instant où
l'utilisateur accepte. Le fichier `server/data/subscriptions.json`
(`PUSH_STORE_PATH`) contient, par appareil abonné :

- l'URL opaque de son service de push et les deux clés de chiffrement imposées
  par le protocole ;
- la classe ou l'enseignant suivi, les deux options activées, la langue.

Ni nom, ni adresse, ni adresse IP, ni historique. Couper les notifications
supprime l'enregistrement, et un service de push qui répond 404 ou 410 le fait
supprimer aussi. En conteneur, ce fichier doit vivre sur un volume — c'est déjà
le cas dans `compose.yaml`.

Le contenu des notifications est chiffré de bout en bout (RFC 8291) : le service
de push relaie un message qu'il ne peut pas lire.

## Sécurité

Choix faits pour que l'application puisse être exposée publiquement :

- **Aucune authentification, aucune donnée personnelle.** Les emplois du temps de l'ULCO
  sont déjà publics via le lien ADE ; l'application n'ajoute ni compte, ni cookie, ni
  journal nominatif. Seuls les abonnements aux notifications sont conservés, et
  uniquement pour qui les demande (voir plus haut).
- **Les routes d'abonnement valident la ressource auprès d'ADE** avant d'enregistrer
  quoi que ce soit, n'acceptent qu'une URL de push `https`, et refusent les salles :
  une salle n'a pas d'élèves à prévenir.
- **Le jeton ADE reste côté serveur** et n'apparaît jamais dans une réponse.
- **Pas de SSRF.** L'identifiant de groupe demandé par le client est vérifié dans le
  catalogue avant tout appel sortant, l'URL du flux est re-vérifiée contre le domaine
  ADE configuré, les redirections sont refusées et la taille des réponses est plafonnée.
- **En-têtes.** CSP stricte (`default-src 'self'`, pas de script en ligne), `nosniff`,
  `frame-ancestors 'none'`, `Referrer-Policy: no-referrer`, HSTS (via Helmet).
- **Limite de débit** de 120 requêtes/minute par IP, qui protège aussi le serveur ADE.
  `TRUST_PROXY` reste à `false` par défaut pour qu'un `X-Forwarded-For` forgé ne puisse
  pas la contourner.
- **Cache et anti-avalanche** : un seul appel ADE part même si cent téléphones
  demandent le même groupe en même temps.
- **Échappements** : les valeurs venant d'ADE sont échappées avant d'être réinjectées
  dans une requête GWT, dans un en-tête HTTP ou dans le flux iCalendar produit. Vue
  échappe le HTML par défaut et l'application n'utilise pas `v-html`.

## Déploiement

```bash
docker build -t edt-ulco .
docker run -p 3000:3000 -e TRUST_PROXY=true -v edt-data:/app/server/data edt-ulco
```

Derrière un reverse proxy en HTTPS (nginx, Traefik, tunnel Cloudflare), mettre
`TRUST_PROXY=true`. HTTPS n'est pas optionnel si l'on veut les notifications :
les navigateurs refusent le service worker hors contexte sûr (`localhost` excepté).

### Tunnel Cloudflare

En production, le service n'est pas exposé directement : un tunnel Cloudflare
ouvre une connexion **sortante** vers Cloudflare et joint `edt:3000` par le
réseau Docker du projet (`edt_default`). Le VPS n'a donc besoin d'aucun port
entrant, et le certificat TLS est celui de Cloudflare — ni nginx ni certbot.

Le tunnel est **géré depuis le tableau de bord** Cloudflare (Zero Trust →
Networks → Tunnels) : il s'y déclare un *public hostname* `edt-iut.online` vers
`http://edt:3000`, et le tableau de bord fournit un jeton. Le tunnel tourne dans
sa propre pile, hors du dépôt, pour que le jeton ne croise jamais git :

```yaml
# ~/edt-tunnel/compose.yaml
services:
  tunnel:
    image: cloudflare/cloudflared:latest
    restart: unless-stopped
    command: tunnel --no-autoupdate run
    environment:
      TUNNEL_TOKEN: ${TUNNEL_TOKEN}
    networks: [edt_default]

networks:
  edt_default:
    external: true
```

Le jeton va dans `~/edt-tunnel/.env` (`TUNNEL_TOKEN=…`, en `chmod 600`) : il
suffit à lui seul à se faire passer pour le site. Le réseau `edt_default` est
celui créé par ce dépôt ; il doit donc être lancé en premier.

Hors notifications, le service ne stocke rien et peut être redémarré librement.
Avec elles, il tient un fichier d'abonnements : le volume `edt-data` doit suivre
le conteneur. Le planificateur suppose par ailleurs **une seule instance** —
plusieurs répliques enverraient chacune leur copie de la même notification.

## Limites connues

- ADE ne publie pas le type de séance (CM/TD/TP) dans un champ dédié : il est déduit
  du suffixe de l'intitulé (« R1-06 Maths TD1 »). Les intitulés sans suffixe reconnu
  s'affichent sans étiquette.
- La fenêtre servie par ADE fait environ douze semaines ; les semaines très éloignées
  demandent un nouvel appel (transparent pour l'utilisateur).
- Le dialogue GWT dépend de la version d'ADE (ici 6.13 / client 2022.2). Une mise à jour
  de l'ULCO peut demander de relever à nouveau les signatures dans `server/src/ade/gwt.ts`.
- Les changements sont détectés en comparant deux relevés successifs, gardés en mémoire.
  Un redémarrage repart d'une page blanche : ce qui a bougé pendant l'arrêt ne sera pas
  annoncé. C'est le prix à payer pour ne rien accumuler sur disque.
- Les notifications de changement ne peuvent pas être plus fraîches que le relevé
  (`PUSH_POLL_MS`, cinq minutes par défaut) ni que le cache d'ADE.
- iOS n'accepte les notifications push que si l'application a été ajoutée à l'écran
  d'accueil (iOS 16.4 ou plus récent). Dans Safari, l'interrupteur restera sans effet.
