import { AiProvider } from './AiProvider.js'

const DEFAULT_TIMEOUT = 60_000

function normalizeBaseUrl(value) {
  return String(value || 'http://localhost:11434').trim().replace(/\/+$/, '')
}

function timeoutSignal(timeout, externalSignal) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new DOMException('Tiempo de espera agotado', 'TimeoutError')), timeout)
  const abort = () => controller.abort(externalSignal.reason)
  externalSignal?.addEventListener('abort', abort, { once: true })
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer)
      externalSignal?.removeEventListener('abort', abort)
    },
  }
}

export class OllamaProvider extends AiProvider {
  constructor({ baseUrl, model, fetcher = fetch, timeout = DEFAULT_TIMEOUT } = {}) {
    super()
    this.baseUrl = normalizeBaseUrl(baseUrl)
    this.model = String(model || 'qwen3:4b').trim()
    this.fetcher = fetcher
    this.timeout = timeout
  }

  async request(path, options = {}) {
    const requestSignal = timeoutSignal(this.timeout, options.signal)
    try {
      const response = await this.fetcher(`${this.baseUrl}${path}`, {
        ...options,
        signal: requestSignal.signal,
        headers: { 'Content-Type': 'application/json', ...options.headers },
      })
      if (!response.ok) throw new Error(`Ollama respondió con HTTP ${response.status}.`)
      return await response.json()
    } finally {
      requestSignal.dispose()
    }
  }

  async checkAvailability({ signal } = {}) {
    const result = await this.request('/api/tags', { signal })
    const models = Array.isArray(result.models) ? result.models.map((item) => item.name) : []
    const available = models.some((name) => name === this.model)
    return { available, models, model: this.model }
  }

  async generateAnswer({ question, context, conversation = [], signal } = {}) {
    const result = await this.request('/api/chat', {
      method: 'POST',
      signal,
      body: JSON.stringify({
        model: this.model,
        stream: false,
        format: 'json',
        think: false,
        options: { temperature: 0.2 },
        messages: [
          {
            role: 'system',
            content: [
              'Eres el secretario personal de Second Mind. Responde en español.',
              'Usa exclusivamente el dossier proporcionado. No inventes hechos.',
              'Devuelve JSON válido con esta forma exacta:',
              '{"answer":"recomendación y motivos","sourceIds":["S1","S2"],"insufficientEvidence":false}',
              'sourceIds solo puede contener identificadores presentes en el dossier.',
              'Si no hay evidencia suficiente, dilo y marca insufficientEvidence como true.',
              'No propongas que ya has modificado tareas o notas.',
            ].join('\n'),
          },
          ...conversation.slice(-6).map((message) => ({
            role: message.role,
            content: message.content,
          })),
          {
            role: 'user',
            content: `DOSSIER\n${context.prompt}\n\nPREGUNTA\n${question}`,
          },
        ],
      }),
    })

    let parsed
    try {
      parsed = JSON.parse(result?.message?.content)
    } catch {
      throw new Error('Ollama devolvió una respuesta que no tiene el formato esperado.')
    }
    if (!parsed || typeof parsed.answer !== 'string' || !Array.isArray(parsed.sourceIds)) {
      throw new Error('Ollama devolvió una respuesta incompleta.')
    }
    const references = [...new Set(parsed.sourceIds)]
      .map((sourceId) => context.sourceMap[sourceId])
      .filter(Boolean)
    return {
      text: parsed.answer.trim(),
      references,
      insufficientEvidence: Boolean(parsed.insufficientEvidence),
    }
  }
}
