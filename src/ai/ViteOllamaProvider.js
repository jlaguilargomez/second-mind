import { AiProvider } from './AiProvider.js'

const REQUEST_EVENT = 'second-mind:ollama'
const RESPONSE_EVENT = 'second-mind:ollama-response'
const TIMEOUT = 75_000

function requestFromVite(payload, signal) {
  if (!import.meta.hot) throw new Error('El puente local de desarrollo no está disponible.')
  const requestId = crypto.randomUUID()

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => cleanup(new DOMException('Tiempo de espera agotado', 'TimeoutError')), TIMEOUT)
    const onAbort = () => cleanup(signal.reason || new DOMException('Cancelado', 'AbortError'))
    const onResponse = (response) => {
      if (response.requestId !== requestId) return
      if (response.error) cleanup(new Error(response.error))
      else cleanup(null, response.result)
    }
    const cleanup = (error, result) => {
      clearTimeout(timer)
      import.meta.hot.off( RESPONSE_EVENT, onResponse)
      signal?.removeEventListener('abort', onAbort)
      if (error) reject(error)
      else resolve(result)
    }

    import.meta.hot.on(RESPONSE_EVENT, onResponse)
    signal?.addEventListener('abort', onAbort, { once: true })
    import.meta.hot.send(REQUEST_EVENT, { requestId, ...payload })
  })
}

export class ViteOllamaProvider extends AiProvider {
  constructor({ model = 'qwen3:4b' } = {}) {
    super()
    this.model = model
  }

  async checkAvailability({ signal } = {}) {
    return requestFromVite({ operation: 'tags', model: this.model }, signal)
  }

  async generateAnswer({ question, context, conversation = [], signal } = {}) {
    const result = await requestFromVite({
      operation: 'chat',
      model: this.model,
      question,
      prompt: context.prompt,
      conversation: conversation.slice(-6),
    }, signal)
    if (!result || typeof result.answer !== 'string' || !Array.isArray(result.sourceIds)) {
      throw new Error('Ollama devolvió una respuesta incompleta.')
    }
    return {
      text: result.answer.trim(),
      references: [...new Set(result.sourceIds)].map((id) => context.sourceMap[id]).filter(Boolean),
      insufficientEvidence: Boolean(result.insufficientEvidence),
    }
  }
}
