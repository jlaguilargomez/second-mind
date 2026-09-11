import test from 'node:test'
import assert from 'node:assert/strict'
import { OllamaProvider } from '../src/ai/OllamaProvider.js'

function response(body, ok = true, status = 200) {
  return { ok, status, json: async () => body }
}

test('comprueba si el modelo configurado está instalado', async () => {
  const provider = new OllamaProvider({
    model: 'qwen3:4b',
    fetcher: async () => response({ models: [{ name: 'qwen3:4b' }] }),
  })
  assert.equal((await provider.checkAvailability()).available, true)
})

test('valida la respuesta y descarta referencias inventadas', async () => {
  const provider = new OllamaProvider({
    fetcher: async () => response({
      message: { content: '{"answer":"Haz la tarea.","sourceIds":["S1","S99"],"insufficientEvidence":false}' },
    }),
  })
  const answer = await provider.generateAnswer({
    question: '¿Qué hago?',
    context: {
      prompt: '[S1] tarea',
      sourceMap: { S1: { sourceId: 'S1', noteId: 'n1', blockId: 'b1' } },
    },
  })
  assert.equal(answer.text, 'Haz la tarea.')
  assert.deepEqual(answer.references.map((item) => item.sourceId), ['S1'])
})

test('informa de respuestas inválidas y errores HTTP', async () => {
  const invalid = new OllamaProvider({
    fetcher: async () => response({ message: { content: 'no es json' } }),
  })
  await assert.rejects(
    invalid.generateAnswer({ question: 'x', context: { prompt: '', sourceMap: {} } }),
    /formato esperado/,
  )
  const disconnected = new OllamaProvider({
    fetcher: async () => response({}, false, 503),
  })
  await assert.rejects(disconnected.checkAvailability(), /HTTP 503/)
})

test('respeta una cancelación externa', async () => {
  const controller = new AbortController()
  const provider = new OllamaProvider({
    fetcher: async (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
    }),
  })
  const pending = provider.checkAvailability({ signal: controller.signal })
  controller.abort(new DOMException('Cancelado', 'AbortError'))
  await assert.rejects(pending, /Cancelado/)
})

test('cancela una petición que supera el timeout', async () => {
  const provider = new OllamaProvider({
    timeout: 5,
    fetcher: async (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
    }),
  })
  await assert.rejects(provider.checkAvailability(), /Tiempo de espera agotado/)
})
