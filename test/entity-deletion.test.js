import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { removeContextReference, removeTagReference } from '../src/lib/markdown.js'

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

test('la interfaz confirma y expone el borrado de contextos y etiquetas', async () => {
  const app = await readFile(new URL('../src/App.vue', import.meta.url), 'utf8')

  assert.match(app, /function deleteContext\(name\)/)
  assert.match(app, /function deleteTag\(name\)/)
  assert.match(app, /window\.confirm/)
  assert.match(app, /Eliminar contexto/)
  assert.match(app, /Eliminar #\{\{ selectedTag \}\}/)
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
