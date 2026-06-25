import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  removeContextReference,
  removeTagReference,
  replaceContextReference,
} from '../src/lib/markdown.js'

test('elimina únicamente las menciones del contexto indicado', () => {
  assert.equal(
    removeContextReference('Revisar @Motor y @Motorista con [[Motor]] y [[Otro]]', 'motor'),
    'Revisar  y @Motorista con  y [[Otro]]',
  )
})

test('elimina etiquetas completas sin afectar etiquetas con prefijo común', () => {
  assert.equal(
    removeTagReference('Algo #Casa y #Casamiento; también #casa', 'casa'),
    'Algo  y #Casamiento; también ',
  )
})

test('renombra únicamente las menciones exactas del contexto indicado', () => {
  assert.equal(
    replaceContextReference('Revisar @Motor y @Motorista con [[motor]] y [[Otro]]', 'motor', 'joselu'),
    'Revisar @joselu y @Motorista con [[joselu]] y [[Otro]]',
  )
})

test('renombra contextos sin importar mayúsculas y conserva el nombre final canónico', () => {
  assert.equal(
    replaceContextReference('@JOSEL habló con [[josel]] y @Josel', 'josel', 'joselu'),
    '@joselu habló con [[joselu]] y @joselu',
  )
})

test('la interfaz confirma y expone el borrado de contextos y etiquetas', async () => {
  const app = await readFile(new URL('../src/App.vue', import.meta.url), 'utf8')

  assert.match(app, /function deleteContext\(name\)/)
  assert.match(app, /function deleteTag\(name\)/)
  assert.match(app, /window\.confirm/)
  assert.match(app, /Eliminar contexto/)
  assert.match(app, /Eliminar #\{\{ selectedTag \}\}/)
  assert.match(app, /function saveContextRename\(\)/)
  assert.match(app, /Renombrar contexto/)
})

test('el borrado de referencias actualiza notas afectadas en lote', async () => {
  const composable = await readFile(
    new URL('../src/composables/useSecondMind.js', import.meta.url),
    'utf8',
  )

  assert.match(composable, /function replaceNotes\(updatedNotes\)/)
  assert.match(composable, /const prepared = affected\.map/)
  assert.match(composable, /replaceNotes\(prepared\.map/)
  assert.doesNotMatch(composable, /for \(const note of affected\) \{[\s\S]*replaceNote\(note\)/)
})

test('el renombrado de contextos reescribe referencias, renombra notas y fusiona con destino existente', async () => {
  const [composable, storage] = await Promise.all([
    readFile(new URL('../src/composables/useSecondMind.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/storage.js', import.meta.url), 'utf8'),
  ])

  assert.match(composable, /async function renameContext\(oldName, newName\)/)
  assert.match(composable, /replaceContextReference\(block\.content, sourceName, targetName\)/)
  assert.match(composable, /filename: `\$\{contextSlug\(targetName\) \|\| 'contexto'\}\.md`/)
  assert.match(composable, /const mergeTargetNote = targetNote && targetNote\.id !== sourceNote\?\.id \? targetNote : null/)
  assert.match(composable, /await repository\.deleteNote\(sourceNote\.id\)/)
  assert.match(composable, /selectedContext\.value = targetName/)
  assert.match(storage, /export async function removeNote\(root, note\)/)
})
