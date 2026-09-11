import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'

const OLLAMA_URL = 'http://127.0.0.1:11434'
const assistantSystemPrompt = [
  'Eres el secretario personal de Second Mind. Responde en español.',
  'Usa exclusivamente el dossier proporcionado. No inventes hechos.',
  'Devuelve JSON válido con esta forma exacta:',
  '{"answer":"recomendación y motivos","sourceIds":["S1","S2"],"insufficientEvidence":false}',
  'sourceIds solo puede contener identificadores presentes en el dossier.',
  'Si no hay evidencia suficiente, dilo y marca insufficientEvidence como true.',
  'No propongas que ya has modificado tareas o notas.',
].join('\n')

function localOllamaBridge() {
  return {
    name: 'local-ollama-bridge',
    configureServer(server) {
      server.ws.on('second-mind:ollama', async (payload) => {
        const response = { requestId: payload.requestId }
        try {
          if (payload.operation === 'tags') {
            const result = await fetch(`${OLLAMA_URL}/api/tags`, {
              signal: AbortSignal.timeout(5_000),
            }).then((item) => item.json())
            const models = Array.isArray(result.models) ? result.models.map((item) => item.name) : []
            response.result = {
              available: models.includes(payload.model),
              models,
              model: payload.model,
            }
          } else if (payload.operation === 'chat') {
            const result = await fetch(`${OLLAMA_URL}/api/chat`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              signal: AbortSignal.timeout(75_000),
              body: JSON.stringify({
                model: payload.model,
                stream: false,
                format: 'json',
                think: false,
                options: { temperature: 0.2 },
                messages: [
                  { role: 'system', content: assistantSystemPrompt },
                  ...(payload.conversation || []),
                  { role: 'user', content: `DOSSIER\n${payload.prompt}\n\nPREGUNTA\n${payload.question}` },
                ],
              }),
            })
            if (!result.ok) throw new Error(`Ollama respondió con HTTP ${result.status}.`)
            response.result = JSON.parse((await result.json()).message.content)
          } else {
            throw new Error('Operación de asistente no reconocida.')
          }
        } catch (error) {
          response.error = error.message || 'No se pudo conectar con Ollama.'
        }
        server.ws.send('second-mind:ollama-response', response)
      })
    },
  }
}

export default defineConfig({
  server: {
    proxy: {
      '/assistant-api': {
        target: 'http://127.0.0.1:11434',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/assistant-api/, ''),
      },
    },
  },
  plugins: [
    localOllamaBridge(),
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
