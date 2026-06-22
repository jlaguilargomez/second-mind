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

test('los controles comparten un foco accesible y coherente con la identidad visual', async () => {
  const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8')

  assert.match(styles, /:focus-visible/)
  assert.match(styles, /outline:\s*2px solid #6f9185/)
  assert.match(styles, /\.task-toggle:focus-visible/)
  assert.match(styles, /box-shadow:\s*0 0 0 2px var\(--paper\), 0 0 0 4px #6f9185/)
  assert.doesNotMatch(styles, /outline:\s*none\s*!important/)
})

test('las tareas completadas mantienen el mismo estado visual en texto, contextos y tarjetas', async () => {
  const [app, editor, styles] = await Promise.all([
    readFile(new URL('../src/App.vue', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/BlockEditor.vue', import.meta.url), 'utf8'),
    readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
  ])

  assert.match(app, /:class="\{ completed: task\.checked \}"/)
  assert.match(editor, /:aria-pressed="block\.checked"/)
  assert.match(styles, /\.block-task\.completed \.block-rendered button/)
  assert.match(styles, /\.task-card\.completed > div > span button/)
  assert.match(styles, /\.task-card\s*\{\s*grid-template-columns:\s*24px minmax\(0, 1fr\);/)
  assert.match(styles, /\.task-card \.reminder-button\s*\{[\s\S]*grid-column:\s*2;/)
  assert.match(app, /`Diario · \$\{formatReminderDate/)
})

test('el día y el contexto permiten copiar una sección Markdown limpia', async () => {
  const [app, styles] = await Promise.all([
    readFile(new URL('../src/App.vue', import.meta.url), 'utf8'),
    readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
  ])

  assert.match(app, /serializeJournalShare/)
  assert.match(app, /serializeContextShare/)
  assert.match(app, /Copiar sección como Markdown/)
  assert.match(app, /navigator\.clipboard\?\.writeText/)
  assert.match(app, /document\.execCommand\('copy'\)/)
  assert.match(styles, /\.copy-section-button/)
  assert.match(styles, /\.copy-section-button\.copied/)
})

test('las tareas permiten combinar filtros de contexto, prioridad y etiqueta', async () => {
  const [app, styles] = await Promise.all([
    readFile(new URL('../src/App.vue', import.meta.url), 'utf8'),
    readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
  ])

  assert.match(app, /const priorityFilter = ref\('all'\)/)
  assert.match(app, /Filtrar tareas por contexto/)
  assert.match(app, /Filtrar tareas por prioridad/)
  assert.match(app, /Filtrar tareas por etiqueta/)
  assert.match(app, /\(task\.priority \|\| 'base'\) !== priorityFilter\.value/)
  assert.match(app, /function clearTaskFilters\(\)/)
  assert.match(app, /Limpiar filtros/)
  assert.match(styles, /\.task-filter-selects/)
  assert.match(styles, /grid-template-columns:\s*repeat\(3,/)
})

test('contextos y etiquetas desplazan su contenido sin invadir el pie lateral', async () => {
  const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8')

  assert.match(styles, /\.contexts-section\s*\{[\s\S]*overflow-y:\s*auto/)
  assert.match(styles, /\.tags-section\s*\{[\s\S]*flex:\s*1 1 auto;[\s\S]*overflow-y:\s*auto/)
  assert.match(styles, /\.sidebar-footer\s*\{[\s\S]*flex:\s*0 0 auto;/)
  assert.match(styles, /overscroll-behavior:\s*contain/)
})
