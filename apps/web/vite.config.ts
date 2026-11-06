import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // Our own service worker (src/sw.ts): precache plus push notification handling.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectRegister: false,
      devOptions: { enabled: true, type: 'module' },
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png'],
      injectManifest: {
        // BlockNote ships emoji picker data per language (~4 MB). The picker is off, so never precache it.
        globIgnores: ['**/emoji-data-*.js', '**/{ar,de,en,es,fa,fr,he,hr,is,it,ja,ko,nb,nl,pl,pt,ru,sk,tr,uk,uz,vi,zh,zh-hant}-*-*.js'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
      },
      manifest: {
        name: 'NonsTop',
        short_name: 'NonsTop',
        description: 'Workspace pribadi untuk catatan, task, ide, dan proyek.',
        lang: 'id',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#18181b',
        theme_color: '#18181b',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        // Long-press on the launcher icon (F-50).
        shortcuts: [{ name: 'Catatan baru', short_name: 'Catatan', url: '/quick', icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }] }],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:8787' },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['src/test-setup.ts'],
  },
});
