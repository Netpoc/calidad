import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  /**
   * Where `npm run dev` sends /api. Defaults to the local server so day-to-day
   * development never writes into production data. To develop against Render,
   * put VITE_DEV_PROXY_TARGET=https://calidad-tthd.onrender.com in
   * client/.env.local (gitignored).
   */
  const devProxyTarget = env.VITE_DEV_PROXY_TARGET || 'http://localhost:4000'

  return {
    plugins: [
      vue(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.svg'],
        manifest: {
          name: 'Calidad Laundry',
          short_name: 'Calidad',
          description: 'Laundry booking and branch management',
          theme_color: '#0f766e',
          background_color: '#ffffff',
          display: 'standalone',
          orientation: 'portrait',
          start_url: '/',
          icons: [
            { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
            {
              src: 'pwa-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
          runtimeCaching: [
            {
              // The price list must be readable offline, but the owner edits it
              // and must see the edit at once. NetworkFirst gives both: a live
              // response when online, the cached copy when not. (StaleWhile-
              // Revalidate served the pre-edit list back after every save.)
              // Instant display is the Dexie cache's job (stores/pricing.ts),
              // so the network wait here only delays the background refresh.
              urlPattern: /\/api\/pricing/,
              handler: 'NetworkFirst',
              options: { cacheName: 'pricing', networkTimeoutSeconds: 5 },
            },
            {
              // Reads may be stale offline; writes are never cached — they go to
              // the Dexie outbox instead (see src/offline/).
              urlPattern: /\/api\/(branches|customers)/,
              handler: 'NetworkFirst',
              options: {
                cacheName: 'reference-data',
                networkTimeoutSeconds: 5,
              },
            },
          ],
        },
        devOptions: { enabled: true, type: 'module' },
      }),
    ],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    build: {
      rollupOptions: {
        output: {
          // Framework code changes far less often than app code, so splitting it
          // keeps repeat visits off mobile data — which matters for staff working
          // from a phone in a branch.
          manualChunks: {
            vendor: ['vue', 'vue-router', 'pinia', 'axios', 'dexie'],
          },
        },
      },
    },
    server: {
      port: 5173,
      proxy: { '/api': { target: devProxyTarget, changeOrigin: true } },
    },
  }
})
