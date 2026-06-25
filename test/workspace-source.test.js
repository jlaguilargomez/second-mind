import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('la caché local puede reemplazarse por completo con las notas de la carpeta', async () => {
  const repository = await readFile(
    new URL('../src/repositories/LocalRepository.js', import.meta.url),
    'utf8',
  )

  assert.match(repository, /async replaceAllNotes\(notes\)/)
  assert.match(repository, /notesStore\.clear\(\)/)
  assert.match(repository, /transaction\.objectStore\(OPERATIONS_STORE\)\.clear\(\)/)
  assert.match(repository, /for \(const note of notes\) notesStore\.put\(note\)/)
})

test('las importaciones masivas se guardan en una sola transacción local', async () => {
  const [repository, composable] = await Promise.all([
    readFile(new URL('../src/repositories/LocalRepository.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/composables/useSecondMind.js', import.meta.url), 'utf8'),
  ])

  assert.match(repository, /async saveNotes\(notes/)
  assert.match(repository, /for \(const note of notes\)/)
  assert.match(composable, /const imports = \[\]/)
  assert.match(composable, /await repository\.saveNotes\(importedNotes\)/)
  assert.doesNotMatch(composable, /async function importMarkdown/)
})

test('la importación de carpeta Reflect lee markdowns recursivamente', async () => {
  const [storage, composable, app] = await Promise.all([
    readFile(new URL('../src/lib/storage.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/composables/useSecondMind.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/App.vue', import.meta.url), 'utf8'),
  ])

  assert.match(storage, /export async function readMarkdownTree\(root/)
  assert.match(storage, /readMarkdownTree\(handle, path\)/)
  assert.match(composable, /async function importDirectory\(\)/)
  assert.match(composable, /showDirectoryPicker\(\{ mode: 'read' \}\)/)
  assert.match(composable, /const markdownFiles = await readMarkdownTree\(handle\)/)
  assert.match(composable, /createImportedNote\(file\.filename, file\.markdown, file\.updatedAt, file\.path\)/)
  assert.match(app, /Importar carpeta Reflect/)
  assert.match(app, /function importReflectDirectory\(\)/)
})

test('la importación usa identidad estable para evitar duplicados al reimportar Reflect', async () => {
  const composable = await readFile(
    new URL('../src/composables/useSecondMind.js', import.meta.url),
    'utf8',
  )

  assert.match(composable, /function importIdentity\(note\)/)
  assert.match(composable, /journal:\$\{note\.date \|\| note\.filename\}/)
  assert.match(composable, /context:\$\{note\.title\.toLocaleLowerCase\(\)\}/)
  assert.match(composable, /existing \? \{ \.\.\.note, id: existing\.id \} : note/)
})

test('al restaurar una carpeta conectada, la carpeta reemplaza el estado de IndexedDB', async () => {
  const composable = await readFile(
    new URL('../src/composables/useSecondMind.js', import.meta.url),
    'utf8',
  )

  assert.match(composable, /const workspaceRestored = await restoreWorkspace\(\)/)
  assert.match(composable, /if \(workspaceRestored\) await loadWorkspaceFromDisk\(\)/)
  assert.match(composable, /async function applyWorkspaceNotes\(diskNotes\)/)
  assert.match(composable, /notes\.value = workspaceNotes/)
  assert.match(composable, /await repository\.replaceAllNotes\(workspaceNotes\)/)
})

test('al conectar una carpeta, solo se exporta el estado actual si la carpeta está vacía', async () => {
  const composable = await readFile(
    new URL('../src/composables/useSecondMind.js', import.meta.url),
    'utf8',
  )

  assert.match(composable, /const diskNotes = await readWorkspace\(handle\)/)
  assert.match(composable, /if \(diskNotes\.length && !hasPendingLocalImport\) \{\s*await applyWorkspaceNotes\(diskNotes\)/)
  assert.match(composable, /const notesToWrite = hasPendingLocalImport/)
  assert.match(composable, /for \(const note of notesToWrite\) await writeNote\(handle, note\)/)
  assert.match(composable, /await repository\.replaceAllNotes\(notesToWrite\)/)
})

test('al conectar carpeta después de importar Reflect, vuelca la importación local a disco', async () => {
  const composable = await readFile(
    new URL('../src/composables/useSecondMind.js', import.meta.url),
    'utf8',
  )

  assert.match(composable, /let hasPendingLocalImport = false/)
  assert.match(composable, /hasPendingLocalImport = true/)
  assert.match(composable, /mergeImportedNotesWithDisk\(diskNotes\)/)
  assert.match(composable, /function mergeImportedNotesWithDisk\(diskNotes\)/)
  assert.match(composable, /merged\.set\(importIdentity\(note\), note\)/)
  assert.match(composable, /hasPendingLocalImport = false/)
})

test('la interfaz permite recargar manualmente desde carpeta y evita llamar local al estado conectado', async () => {
  const [app, composable] = await Promise.all([
    readFile(new URL('../src/App.vue', import.meta.url), 'utf8'),
    readFile(new URL('../src/composables/useSecondMind.js', import.meta.url), 'utf8'),
  ])

  assert.match(composable, /async function reloadWorkspaceFromDisk\(\)/)
  assert.match(composable, /activateFirstAvailableNote\(\{ createJournal: false \}\)/)
  assert.match(composable, /activeNoteId\.value = null/)
  assert.match(composable, /'Guardado en carpeta'/)
  assert.match(composable, /'Modo local sin carpeta'/)
  assert.match(app, /function reloadWorkspace\(\)/)
  assert.match(app, /Recargar desde carpeta/)
  assert.match(app, /title="Recargar desde carpeta"/)
})

test('el workspace exporta e importa settings de plantillas mediante second-mind.json', async () => {
  const [app, composable, storage] = await Promise.all([
    readFile(new URL('../src/App.vue', import.meta.url), 'utf8'),
    readFile(new URL('../src/composables/useSecondMind.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/storage.js', import.meta.url), 'utf8'),
  ])

  assert.match(app, /JSON\.stringify\(mind\.createWorkspaceManifest\(\), null, 2\)/)
  assert.match(composable, /settings:\s*workspaceSettings\.value/)
  assert.match(composable, /const dailyTemplates = computed/)
  assert.match(composable, /const activeDailyTemplate = computed/)
  assert.match(composable, /await writeWorkspaceManifest\(directoryHandle\.value, createWorkspaceManifest\(\)\)/)
  assert.match(storage, /const WORKSPACE_MANIFEST = 'second-mind\.json'/)
  assert.match(storage, /notes\.workspaceManifest = await readWorkspaceManifest\(root\)/)
  assert.match(storage, /export async function writeWorkspaceManifest\(root, manifest\)/)
})

test('conectar carpeta e importar markdown viven en la barra superior, no en el lateral', async () => {
  const [app, styles] = await Promise.all([
    readFile(new URL('../src/App.vue', import.meta.url), 'utf8'),
    readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
  ])

  assert.match(app, /title="Conectar carpeta local"/)
  assert.match(app, /title="Importar Markdown o ZIP"/)
  assert.match(app, /title="Importar carpeta Reflect"/)
  assert.match(app, /function importMarkdownFiles\(event\)/)
  assert.match(app, /@change="importMarkdownFiles"/)
  assert.doesNotMatch(app, /Importar Markdown \/ ZIP/)
  assert.doesNotMatch(app, /Importación puntual/)
  assert.doesNotMatch(app, /class="workspace-button"/)
  assert.doesNotMatch(app, /class="floating-import"/)
  assert.doesNotMatch(styles, /\.workspace-button/)
  assert.doesNotMatch(styles, /\.footer-label/)
  assert.doesNotMatch(styles, /\.floating-import/)
})
