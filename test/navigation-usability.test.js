import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('la navegación móvil ofrece búsqueda y describe correctamente el panel lateral', async () => {
  const app = await readFile(new URL('../src/App.vue', import.meta.url), 'utf8')

  assert.match(app, />⌕<\/span>Buscar<\/button>/)
  assert.match(app, /aria-label="Calendario y próximos recordatorios"/)
  assert.match(app, /class="mobile-panel-backdrop"/)
})

test('la búsqueda permite abrir contextos directamente y aceptar el primer resultado con Intro', async () => {
  const app = await readFile(new URL('../src/App.vue', import.meta.url), 'utf8')

  assert.match(app, /const searchContextResults = computed/)
  assert.match(app, /function openFirstSearchResult\(\)/)
  assert.match(app, /@keydown\.enter\.prevent="openFirstSearchResult"/)
  assert.match(app, /openSearchContext\(context\.name\)/)
})

test('el resumen diario cuenta entradas con contenido y pluraliza sus etiquetas', async () => {
  const app = await readFile(new URL('../src/App.vue', import.meta.url), 'utf8')

  assert.match(app, /const journalEntryCount = computed/)
  assert.match(app, /block\.content\.trim\(\)/)
  assert.match(app, /pluralize\(journalEntryCount, 'entrada'\)/)
  assert.match(app, /pluralize\(journalContextCount, 'contexto'\)/)
})

test('los recordatorios ofrecen fechas rápidas sin introducir horas', async () => {
  const dialog = await readFile(
    new URL('../src/components/ReminderDialog.vue', import.meta.url),
    'utf8',
  )

  assert.match(dialog, /type="date"/)
  assert.doesNotMatch(dialog, /datetime-local/)
  assert.match(dialog, />Hoy<\/button>/)
  assert.match(dialog, />Mañana<\/button>/)
  assert.match(dialog, />En una semana<\/button>/)
})
