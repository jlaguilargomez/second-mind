import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icon.svg', 'pwa-192x192.png', 'pwa-512x512.png'],
      manifest: {
        name: 'Second Mind',
        short_name: 'Second Mind',
        description: 'Diario de trabajo local-first basado en Markdown.',
        theme_color: '#292a27',
        background_color: '#faf8f2',
        display: 'standalone',
        start_url: './',
        scope: './',
        lang: 'es',
        categories: ['productivity', 'utilities'],
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      },
    }),
  ],
  base: './',
})
