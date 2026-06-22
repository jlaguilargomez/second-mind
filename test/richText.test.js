import test from 'node:test'
import assert from 'node:assert/strict'
import { tokenizeRichText } from '../src/lib/richText.js'

test('convierte contextos y etiquetas en tokens inline sin duplicar el texto', () => {
  assert.deepEqual(tokenizeRichText('Revisar con @Sara en @motor #seguimiento'), [
    { type: 'text', value: 'Revisar con ', raw: 'Revisar con ' },
    { type: 'context', value: 'Sara', raw: '@Sara' },
    { type: 'text', value: ' en ', raw: ' en ' },
    { type: 'context', value: 'motor', raw: '@motor' },
    { type: 'text', value: ' ', raw: ' ' },
    { type: 'tag', value: 'seguimiento', raw: '#seguimiento' },
  ])
})

test('presenta wikilinks heredados como contextos navegables', () => {
  assert.deepEqual(tokenizeRichText('Revisar [[Producto Atlas]]'), [
    { type: 'text', value: 'Revisar ', raw: 'Revisar ' },
    { type: 'context', value: 'Producto Atlas', raw: '[[Producto Atlas]]' },
  ])
})
