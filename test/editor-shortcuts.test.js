import test from 'node:test'
import assert from 'node:assert/strict'

import { getCaptureShortcut } from '../src/lib/editorShortcuts.js'

test('convierte + espacio en tarea al inicio del bloque', () => {
  assert.deepEqual(
    getCaptureShortcut({
      key: ' ',
      value: '+',
      selectionStart: 1,
      selectionEnd: 1,
      hasSuggestion: false,
    }),
    {
      marker: '+',
      type: 'task',
      content: '',
      patch: {},
    },
  )
})

test('convierte > espacio en titulo al inicio del bloque', () => {
  assert.deepEqual(
    getCaptureShortcut({
      key: ' ',
      value: '>',
      selectionStart: 1,
      selectionEnd: 1,
      hasSuggestion: false,
    }),
    {
      marker: '>',
      type: 'heading',
      content: '',
      patch: { level: 2 },
    },
  )
})

test('no activa conversion para etiquetas o texto ordinario', () => {
  assert.equal(
    getCaptureShortcut({
      key: ' ',
      value: '#proyecto',
      selectionStart: 9,
      selectionEnd: 9,
      hasSuggestion: false,
    }),
    null,
  )

  assert.equal(
    getCaptureShortcut({
      key: ' ',
      value: 'hola',
      selectionStart: 4,
      selectionEnd: 4,
      hasSuggestion: false,
    }),
    null,
  )
})

test('no activa conversion si hay sugerencias activas o seleccion expandida', () => {
  assert.equal(
    getCaptureShortcut({
      key: ' ',
      value: '+',
      selectionStart: 1,
      selectionEnd: 1,
      hasSuggestion: true,
    }),
    null,
  )

  assert.equal(
    getCaptureShortcut({
      key: ' ',
      value: '>',
      selectionStart: 0,
      selectionEnd: 1,
      hasSuggestion: false,
    }),
    null,
  )
})
