import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  build: {
    // Aucun asset en ligne : la CSP du serveur interdit `data:` pour les scripts et styles.
    assetsInlineLimit: 0,
    target: 'es2022',
  },
  server: {
    port: 5173,
    // API_URL permet de viser un serveur local sur un autre port.
    proxy: { '/api': process.env.API_URL || 'http://localhost:3000' },
  },
});
