import { createApp } from 'vue';
import App from './App.vue';
import './styles.css';

createApp(App).mount('#app');

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
