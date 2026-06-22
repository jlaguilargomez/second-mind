import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('el editor expone tipos de bloque y una acción clara para añadir entradas', async () => {
  const editor = await readFile(
    new URL('../src/components/BlockEditor.vue', import.meta.url),
    'utf8',
  )

  for (const label of ['Log', 'Texto', 'Tarea', 'Título']) {
    assert.match(editor, new RegExp(`label: '${label}'`))
  }
  assert.match(editor, /class="add-entry-button"/)
  assert.match(editor, /Añadir entrada/)
  assert.match(editor, /o pulsa Intro al escribir/)
})

test('Intro crea y enfoca el bloque siguiente salvo cuando se solicita un salto de línea', async () => {
  const editor = await readFile(
    new URL('../src/components/BlockEditor.vue', import.meta.url),
    'utf8',
  )

  assert.match(editor, /event\.key === 'Enter' && !event\.shiftKey/)
  assert.match(editor, /addBlockAfter\(block\.id, type, after\)/)
  assert.match(editor, /if \(newBlock\) focusBlock\(newBlock\.id\)/)
})

test('el blur de la entrada anterior no cancela el foco de la nueva', async () => {
  const editor = await readFile(
    new URL('../src/components/BlockEditor.vue', import.meta.url),
    'utf8',
  )

  assert.match(
    editor,
    /if \(focusedBlockId\.value === blockId\) focusedBlockId\.value = null/,
  )
  assert.match(editor, /focusBlock\(previous\.id\)/)
})

test('el autocompletado se puede recorrer y aceptar sin abandonar el teclado', async () => {
  const editor = await readFile(
    new URL('../src/components/BlockEditor.vue', import.meta.url),
    'utf8',
  )

  assert.match(editor, /\['ArrowDown', 'ArrowUp'\]/)
  assert.match(editor, /\['Enter', 'Tab'\]/)
  assert.match(editor, /activeSuggestionIndex/)
  assert.match(editor, /suggestion\.type === 'context' && suggestion\.query/)
  assert.match(editor, /setSelectionRange\(cursor, cursor\)/)
})

test('el título canónico de la nota no deja controles huérfanos en el editor', async () => {
  const [editor, styles] = await Promise.all([
    readFile(new URL('../src/components/BlockEditor.vue', import.meta.url), 'utf8'),
    readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
  ])

  assert.match(editor, /'document-title-row'/)
  assert.match(styles, /\.document-title-row\s*\{\s*display:\s*none;/)
})

test('los bloques heredados muestran una jerarquía visual discreta', async () => {
  const [editor, styles] = await Promise.all([
    readFile(new URL('../src/components/BlockEditor.vue', import.meta.url), 'utf8'),
    readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
  ])

  assert.match(editor, /'section-child': block\.type !== 'heading'/)
  assert.match(styles, /\.section-child\s*\{[\s\S]*border-left:/)
  assert.match(styles, /\.block-heading \.block-kind-button\s*\{\s*opacity:\s*0;/)
})
