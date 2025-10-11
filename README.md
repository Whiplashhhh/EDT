# EDT
afin de visionner simplement l'emploi du temps




🧠 PROMPT INTERACTIF — Projet “Emploi du Temps Automatisé” (Vue.js + Spring Boot)
Copie-colle tout ce texte dans une nouvelle conversation avec ChatGPT avant de commencer à travailler sur ton projet.


🎯 CONTEXTE GÉNÉRAL ..
Je suis développeur junior et je veux m’exercer sur un projet complet :
Créer une application web qui me permet de consulter automatiquement mon emploi du temps universitaire sans devoir à chaque fois sélectionner la classe, la semaine, etc.
L’application doit être hébergée sur le web, accessible depuis mon iPhone, et je veux pouvoir l’ajouter facilement en raccourci sur l’écran d’accueil (type PWA).

🧩 STACK TECHNIQUE
- Frontend : Vue.js 3 (Composition API, Router, Pinia, Axios)
- Backend : Java Spring Boot (architecture n-tiers : UC / BO / DO / DTO / DAO)
- Base de données : PostgreSQL
- Authentification : JWT ou Session sécurisée
- Design : minimaliste, mobile-first (TailwindCSS ou Vuetify)
- Hébergement : local d’abord, puis potentiel déploiement sur Render, Railway ou autre

🧱 ARCHITECTURE ET STRUCTURE
📦 Backend (Spring Boot — n-tiers)

backend/
 ├── src/main/java/com/edtapp/
 │    ├── controller/        → endpoints REST
 │    ├── usecase/           → logique métier (cas d’usage)
 │    ├── bo/                → Business Objects
 │    ├── dao/               → Data Access Objects
 │    ├── dto/               → Data Transfer Objects
 │    ├── do/                → Domain Objects (entités persistées)
 │    ├── repository/        → interfaces JPA / SQL
 │    ├── service/           → services communs (auth, mapping, etc.)
 │    └── config/            → sécurité, CORS, etc.
 ├── src/main/resources/
 │    ├── application.yml    → configuration Spring Boot
 │    └── schema.sql         → création tables si besoin

💻 Frontend (Vue.js 3)
frontend/

 ├── src/
 │    ├── components/        → composants réutilisables (Header, Button, etc.)
 │    ├── views/             → pages principales (LoginView, HomeView, SettingsView)
 │    ├── router/            → routes Vue Router
 │    ├── store/             → Pinia (état global)
 │    ├── composables/       → hooks personnalisés
 │    ├── services/          → appels API (axios)
 │    ├── assets/            → styles, images, icônes
 │    └── App.vue / main.js  → point d’entrée

🧭 ORDRE DE DÉVELOPPEMENT RECOMMANDÉ
🩵 Phase 1 – Préparation
1. Définir les besoins précis (fonctionnalités, parcours utilisateur).
2. Créer une maquette simple sur Figma (mobile + desktop).
3. Se renseigner sur :
  - L’architecture n-tiers : UC / BO / DAO / DTO / DO.
  - API REST avec Spring Boot.
  - JWT / Spring Security.
  - Vue Router et Pinia.

🔧 Phase 2 – Backend
1. Créer le projet Spring Boot (via Spring Initializr).
2. Configurer PostgreSQL + JPA.
3. Créer les entités (DO) et DAO (repository/).
4. Créer les DTO et mapper avec les DO.
5. Ajouter les UseCases pour :
  - Créer un compte utilisateur.
  - Sauvegarder les préférences d’emploi du temps.
  - Récupérer automatiquement l’emploi du temps.
6. Créer les endpoints REST dans controller/.
7. Tester chaque endpoint avec Postman.

💚 Phase 3 – Frontend
1. Créer le projet Vue.js avec npm create vue@latest.
2. Configurer le router, Pinia et axios.
3. Créer les pages :
  - LoginView.vue
  - HomeView.vue
  - SettingsView.vue
4. Créer un apiService.js pour centraliser les appels backend.
5. Mettre en place la logique d’authentification (stockage token / session).
6. Créer des composants réutilisables (Header, Loader, Boutons, etc.).

🌐 Phase 4 – Intégration
1. Connecter le frontend au backend via les endpoints REST.
2. Tester le login / récupération des préférences / affichage de l’emploi du temps.
3. Gérer le stockage local (localStorage ou Pinia persistante).
4. Ajouter le chargement automatique des données au lancement.

🎨 Phase 5 – UX et Mobile
1. Adapter l’affichage à iPhone (responsive design).
2. Ajouter un manifest.json et un service worker pour en faire une PWA.
3. Tester l’ajout sur l’écran d’accueil (Safari iOS).
4. Ajouter éventuellement une icône personnalisée.

🚀 Phase 6 – Améliorations
1. Ajouter un mode clair/sombre.
2. Permettre la modification des préférences directement depuis l’UI.
3. Ajouter un système de logs ou statistiques.
4. Optimiser la sécurité et les perfs (lazy loading, cache, etc.).
5. Préparer un déploiement sur Render / Railway.

📘 SUJETS À APPROFONDIR AU FIL DU PROJET
- Vue.js 3 (composition API, Router, Pinia)
- Axios + CORS
- Spring Boot (REST, DTO, DAO, services)
- JWT Auth avec Spring Security
- PostgreSQL + JPA
- PWA (manifest, service worker, ajout à l’écran d’accueil)
- TailwindCSS / Vuetify
- Figma (pour maquettes UI)

💬 MODE INTERACTIF
Une fois ce prompt collé dans ChatGPT, tu peux lui poser des questions comme :
- 🪜 « Quelle est ma prochaine étape dans le projet ? »
- 🧱 « Aide-moi à créer l’arborescence backend selon l’architecture n-tiers. »
- 🔐 « Montre-moi comment implémenter le login JWT dans Spring Boot. »
- ⚙️ « Comment connecter le front Vue.js à l’API backend ? »
- 🧩 « Peux-tu générer un exemple de UseCase + Controller + DTO complet ? »
- 📱 « Comment rendre mon site installable sur iPhone (PWA) ? »

🚀 « Comment déployer mon projet complet gratuitement ? »

ChatGPT doit se baser sur ce contexte pour te répondre à chaque fois en suivant la logique du plan ci-dessus, sans repartir de zéro.
