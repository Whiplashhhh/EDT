import { createApp } from 'vue';
import App from './App.vue';
import SharedView from './SharedView.vue';
import { readSharedPage } from './share.js';
import './styles.css';

/* Une semaine ou une journée partagée s'ouvre en lecture seule, hors de l'application. */
const sharedPage = readSharedPage(location.search);
createApp(sharedPage ? SharedView : App, sharedPage ? { page: sharedPage } : null).mount('#app');

/*
 * Le service worker demande un contexte sûr. `localhost` en est un : sans lui,
 * les notifications push seraient intestables en développement.
 */
const secure = location.protocol === 'https:' || location.hostname === 'localhost';
if ('serviceWorker' in navigator && secure) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Le hors-ligne est un confort : son échec ne doit pas gêner l'utilisation.
    });
  });
}
