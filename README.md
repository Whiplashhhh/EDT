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

## Sécurité

Choix faits pour que l'application puisse être exposée publiquement :

- **Aucune authentification, aucune donnée personnelle.** Les emplois du temps de l'ULCO
  sont déjà publics via le lien ADE ; l'application n'ajoute ni compte, ni cookie, ni
  journal nominatif.
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
docker run -p 3000:3000 -e TRUST_PROXY=true edt-ulco
```

Derrière un reverse proxy en HTTPS (nginx, Traefik), mettre `TRUST_PROXY=true`.
Le service ne stocke rien sur disque : il est sans état et peut être redémarré ou
répliqué librement.

## Limites connues

- ADE ne publie pas le type de séance (CM/TD/TP) dans un champ dédié : il est déduit
  du suffixe de l'intitulé (« R1-06 Maths TD1 »). Les intitulés sans suffixe reconnu
  s'affichent sans étiquette.
- La fenêtre servie par ADE fait environ douze semaines ; les semaines très éloignées
  demandent un nouvel appel (transparent pour l'utilisateur).
- Le dialogue GWT dépend de la version d'ADE (ici 6.13 / client 2022.2). Une mise à jour
  de l'ULCO peut demander de relever à nouveau les signatures dans `server/src/ade/gwt.ts`.
