import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
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
            // The price list must be readable offline to book laundry, so serve
            // it from cache first and refresh in the background.
            urlPattern: /\/api\/pricing/,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'pricing' },
          },
          {
            // Reads may be stale offline; writes are never cached — they go to
            // the Dexie outbox instead (see src/offline/).
            urlPattern: /\/api\/(branches|customers)/,
            handler: 'NetworkFirst',
            options: { cacheName: 'reference-data', networkTimeoutSeconds: 5 },
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
    proxy: { '/api': { target: 'https://calidad-tthd.onrender.com', changeOrigin: true } },
  },
})
