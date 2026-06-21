import test from 'node:test'
import assert from 'node:assert/strict'
import {
  contextSlug,
  dailyTemplate,
  extractContexts,
  titleFromMarkdown,
} from '../src/lib/markdown.js'

test('extrae wikilinks y etiquetas sin duplicados', () => {
  const contexts = extractContexts(
    '- Reunión de [[Producto Atlas]] #cliente\n- Seguimiento de [[Producto Atlas]] #ventas',
  )

  assert.deepEqual(contexts, ['Producto Atlas', 'cliente', 'ventas'])
})

test('admite etiquetas Unicode', () => {
  assert.deepEqual(extractContexts('Notas para #diseño y #revisión'), ['diseño', 'revisión'])
})

test('obtiene el primer encabezado como título', () => {
  assert.equal(titleFromMarkdown('---\ntype: context\n---\n\n# Estrategia 2026'), 'Estrategia 2026')
})

test('crea slugs estables para los archivos de contexto', () => {
  assert.equal(contextSlug('Diseño y Revisión'), 'diseno-y-revision')
})

test('la plantilla diaria conserva la fecha en frontmatter y título', () => {
  const markdown = dailyTemplate('2026-06-21')
  assert.match(markdown, /date: 2026-06-21/)
  assert.match(markdown, /# 2026-06-21/)
})
