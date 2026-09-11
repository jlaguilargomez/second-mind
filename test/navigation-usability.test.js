import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('la navegación móvil ofrece búsqueda desde Más y describe correctamente el panel lateral', async () => {
  const app = await readFile(new URL('../src/App.vue', import.meta.url), 'utf8')

  assert.match(app, /class="mobile-more-grid"/)
  assert.match(app, /<button @click="openSearch"><span>⌕<\/span><b>Buscar<\/b><\/button>/)
  assert.match(app, /aria-controls="mobile-more-menu"/)
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
  assert.match(styles, /outline:\s*2px solid var\(--focus-ring\)/)
  assert.match(styles, /\.task-toggle:focus-visible/)
  assert.match(styles, /box-shadow:\s*0 0 0 2px var\(--paper\), 0 0 0 4px var\(--focus-ring\)/)
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

test('el diario puede aplicar y editar una plantilla diaria personalizable', async () => {
  const [app, styles] = await Promise.all([
    readFile(new URL('../src/App.vue', import.meta.url), 'utf8'),
    readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
  ])

  assert.match(app, /const canApplyDailyTemplate = computed/)
  assert.match(app, /function openTemplateDialog\(\)/)
  assert.match(app, /function saveTemplateDialog\(\)/)
  assert.match(app, /Usar plantilla/)
  assert.doesNotMatch(app, /aria-label="Editar plantilla diaria"/)
  assert.match(app, /PLANTILLA DIARIA/)
  assert.match(app, /Guardar plantilla/)
  assert.match(styles, /\.template-modal/)
  assert.match(styles, /\.page-heading-actions/)
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

test('las etiquetas se presentan como proyectos sin cambiar el Markdown canónico', async () => {
  const [app, composable, styles] = await Promise.all([
    readFile(new URL('../src/App.vue', import.meta.url), 'utf8'),
    readFile(new URL('../src/composables/useSecondMind.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
  ])

  assert.match(composable, /project:\s*'Proyecto'/)
  assert.match(app, /const tagProjects = computed/)
  assert.match(app, /const activeTagProject = computed/)
  assert.match(app, /projectTagBlocks\(allBlocks\.value, tag\.name\)/)
  assert.match(app, /block\.tagMatch/)
  assert.match(app, /block\.tagIndent/)
  assert.match(app, /PROYECTOS POR ETIQUETA/)
  assert.match(app, /Etiquetas \/ Proyectos/)
  assert.match(app, /maxlength="50"/)
  assert.match(app, /Nota breve/)
  assert.match(app, /saveTagDescription/)
  assert.match(composable, /function updateTag\(name, patch\)/)
  assert.match(composable, /description: note\.description \|\| ''/)
  assert.match(app, /Tareas abiertas/)
  assert.match(app, /Tareas completadas/)
  assert.match(app, /Bitácora/)
  assert.doesNotMatch(app, /contextType \|\| 'project'/)
  assert.doesNotMatch(composable, /contextType:\s*note\.contextType \|\| 'project'/)
  assert.doesNotMatch(app, /currentView === 'missions'/)
  assert.doesNotMatch(app, /Misiones Principales/)
  assert.doesNotMatch(app, /Misiones Secundarias/)
  assert.match(app, /supportContexts/)
  assert.match(styles, /\.project-board/)
  assert.match(styles, /\.project-progress/)
  assert.match(styles, /\.tag-note-control/)
})

test('el formulario de nuevo contexto usa área como tipo predeterminado', async () => {
  const app = await readFile(new URL('../src/App.vue', import.meta.url), 'utf8')

  assert.match(app, /const newContextType = ref\(DEFAULT_CONTEXT_TYPE\)/)
  assert.match(app, /newContextType\.value = DEFAULT_CONTEXT_TYPE/)
  assert.doesNotMatch(app, /const newContextType = ref\('project'\)/)
})

test('contextos y etiquetas desplazan su contenido sin invadir el pie lateral', async () => {
  const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8')

  assert.match(styles, /\.contexts-section\s*\{[\s\S]*overflow-y:\s*auto/)
  assert.match(styles, /\.tags-section\s*\{[\s\S]*flex:\s*1 1 auto;[\s\S]*overflow-y:\s*auto/)
  assert.match(styles, /\.sidebar-footer\s*\{[\s\S]*flex:\s*0 0 auto;/)
  assert.match(styles, /overscroll-behavior:\s*contain/)
})

test('contextos y etiquetas tienen vistas completas desde la navegación lateral', async () => {
  const [app, styles] = await Promise.all([
    readFile(new URL('../src/App.vue', import.meta.url), 'utf8'),
    readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
  ])

  assert.match(app, /currentView === 'contexts'/)
  assert.match(app, /currentView === 'tags'/)
  assert.match(app, /navigate\('contexts'\)/)
  assert.match(app, /navigate\('tags'\)/)
  assert.match(app, /v-for="context in contextIndex"/)
  assert.match(app, /v-for="tag in tags"/)
  assert.match(styles, /\.entity-directory/)
  assert.match(styles, /\.tag-directory/)
})

test('la vista de contextos agrupa por tipo manteniendo el fallback por defecto', async () => {
  const [app, styles] = await Promise.all([
    readFile(new URL('../src/App.vue', import.meta.url), 'utf8'),
    readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
  ])

  assert.match(app, /const contextTypeOrder = \['project', 'area', 'team', 'person'\]/)
  assert.match(app, /const groupedContexts = computed\(/)
  assert.match(app, /\(context\.contextType \|\| DEFAULT_CONTEXT_TYPE\) === type/)
  assert.match(app, /v-for="group in groupedContexts"/)
  assert.match(app, /class="context-group"/)
  assert.match(app, /<h2>\{\{ group\.label \}\}<\/h2>/)
  assert.match(app, /group\.contexts\.length/)
  assert.match(app, /<div v-if="contextIndex\.length" class="context-groups">/)
  assert.match(app, /v-for="context in group\.contexts"/)
  assert.match(styles, /\.context-groups/)
  assert.match(styles, /\.context-group/)
})

test('la sección de notas independientes tiene listado, editor y navegación móvil', async () => {
  const [app, storage, composable] = await Promise.all([
    readFile(new URL('../src/App.vue', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/storage.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/composables/useSecondMind.js', import.meta.url), 'utf8'),
  ])

  assert.match(app, /currentView === 'notes'/)
  assert.match(app, /independentNotes/)
  assert.match(app, /Nueva nota/)
  assert.match(app, /Eliminar nota/)
  assert.match(app, /showNoteDialog/)
  assert.doesNotMatch(app, /prompt\('Título de la nota'/)
  assert.match(app, /class="note-card-list"/)
  assert.match(app, /@click="openNotes"/)
  assert.match(app, /function openNotes\(\)\s*\{\s*activeNoteId\.value = null\s*mind\.setView\('notes'\)/)
  assert.doesNotMatch(app, /function openNotes\(\)\s*\{[\s\S]{0,180}mind\.openNote/)
  assert.match(app, /<nav class="breadcrumbs" aria-label="Ruta de navegación">/)
  assert.match(app, /@click="openBreadcrumbParent"/)
  assert.match(app, /return \{ label: 'Notas', target: 'notes' \}/)
  assert.match(storage, /notes: 'note'/)
  assert.match(storage, /\['journals', 'contexts', 'tags', 'notes'\]/)
  assert.match(composable, /function noteFilename/)
  assert.match(composable, /async function openNote\(id\)/)
  assert.match(composable, /async function renameNote\(id, title\)/)
  assert.match(composable, /async function deleteNote\(id\)/)
  assert.match(composable, /const pendingSave = saveTimers\.get\(id\)\s*if \(pendingSave\) clearTimeout\(pendingSave\.timer\)/)
  assert.match(composable, /if \(activeNoteId\.value === id\) \{\s*activeNoteId\.value = null\s*selectedContext\.value = null\s*currentView\.value = 'notes'/)
  assert.match(composable, /note\.kind === 'note' \? \[\] : note\.blocks/)
})

test('la interfaz móvil usa iconos legibles y objetivos táctiles amplios', async () => {
  const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8')

  assert.match(styles, /\.mobile-menu-button\s*\{[\s\S]*width:\s*44px;[\s\S]*height:\s*44px;[\s\S]*font-size:\s*21px;/)
  assert.match(styles, /\.topbar\s*\{[\s\S]*gap:\s*8px;[\s\S]*overflow:\s*hidden;/)
  assert.match(styles, /\.breadcrumbs\s*\{[\s\S]*max-width:\s*min\(38vw,\s*142px\);/)
  assert.match(styles, /\.top-actions\s*\{[\s\S]*max-width:\s*calc\(100vw - 190px\);[\s\S]*overflow-x:\s*auto;/)
  assert.match(styles, /\.top-actions \.icon-button\s*\{[\s\S]*width:\s*44px;[\s\S]*height:\s*44px;[\s\S]*flex:\s*0 0 auto;[\s\S]*font-size:\s*23px;/)
  assert.match(styles, /@media \(max-width:\s*390px\)/)
  assert.match(styles, /\.mobile-nav\s*\{[\s\S]*grid-template-columns:\s*repeat\(5, 1fr\);/)
  assert.match(styles, /\.mobile-nav button span\s*\{\s*font-size:\s*22px;/)
  assert.match(styles, /\.mobile-nav button\s*\{[\s\S]*font-size:\s*12px;/)
  assert.match(styles, /\.task-toggle\s*\{\s*width:\s*24px;\s*height:\s*24px;/)
  assert.match(styles, /\.block-kind-button\s*\{\s*width:\s*26px;\s*height:\s*26px;/)
  assert.match(styles, /\.task-toggle::before, \.block-kind-button::before\s*\{[\s\S]*inset:\s*-9px;/)
})

test('el modo oscuro usa tokens semánticos para texto, controles y estados', async () => {
  const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8')

  assert.match(styles, /--surface-control:\s*#192638/)
  assert.match(styles, /--text-primary:\s*#f2f7fb/)
  assert.match(styles, /--text-muted:\s*#98aabd/)
  assert.match(styles, /--danger:\s*#ff9eaa/)
  assert.match(styles, /\.task-filter-selects select\s*\{[\s\S]*color:\s*var\(--text-primary\);[\s\S]*background-color:\s*var\(--surface-control\);/)
  assert.match(styles, /\.priority-high\s*\{\s*color:\s*var\(--danger\);\s*background:\s*var\(--danger-soft\);/)
})
