import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('el asistente es local, de solo lectura y no persiste conversaciones', async () => {
  const [app, html, security, vite] = await Promise.all([
    readFile(new URL('../src/App.vue', import.meta.url), 'utf8'),
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../SECURITY.md', import.meta.url), 'utf8'),
    readFile(new URL('../vite.config.js', import.meta.url), 'utf8'),
  ])
  assert.match(app, /currentView === 'assistant'/)
  assert.match(app, /buildAssistantContext/)
  assert.match(app, /new OllamaProvider/)
  assert.match(app, /assistantMessages = ref\(\[\]\)/)
  assert.doesNotMatch(app, /setSetting\([^)]*assistantMessages/)
  assert.match(html, /connect-src 'self' http:\/\/localhost:\* http:\/\/127\.0\.0\.1:\*/)
  assert.doesNotMatch(html, /api\.groq|generativelanguage|openai\.com/)
  assert.match(security, /no dispone de operaciones para modificar notas o tareas/)
  assert.match(vite, /'\/assistant-api'/)
  assert.match(vite, /target: 'http:\/\/127\.0\.0\.1:11434'/)
})
