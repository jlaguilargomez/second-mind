import test from 'node:test'
import assert from 'node:assert/strict'
import {
  contextSlug,
  dailyTemplate,
  extractContexts,
  extractTags,
  normalizeNote,
  parseMarkdown,
  reminderState,
  serializeNote,
  titleFromMarkdown,
} from '../src/lib/markdown.js'

test('separa @contextos, #etiquetas y wikilinks heredados', () => {
  const markdown =
    '- Reunión con @motor y [[Producto Atlas]] #cliente\n- Seguimiento de @motor #ventas'

  assert.deepEqual(extractContexts(markdown), ['motor', 'Producto Atlas'])
  assert.deepEqual(extractTags(markdown), ['cliente', 'ventas'])
})

test('admite etiquetas y contextos Unicode', () => {
  assert.deepEqual(extractContexts('Notas para @diseño'), ['diseño'])
  assert.deepEqual(extractTags('Notas para #revisión'), ['revisión'])
})

test('obtiene el primer encabezado como título', () => {
  assert.equal(titleFromMarkdown('---\ntype: context\n---\n\n# Estrategia 2026'), 'Estrategia 2026')
})

test('crea slugs estables para los archivos de contexto', () => {
  assert.equal(contextSlug('Diseño y Revisión'), 'diseno-y-revision')
})

test('la plantilla diaria conserva la fecha, ids y un bloque editable', () => {
  const markdown = dailyTemplate('2026-06-21')
  const parsed = parseMarkdown(markdown)
  assert.match(markdown, /date: 2026-06-21/)
  assert.equal(parsed.title, '2026-06-21')
  assert.equal(parsed.blocks.length, 2)
  assert.ok(parsed.blocks.every((block) => block.id))
})

test('parsea y serializa tareas con recordatorio sin pérdida', () => {
  const markdown = `---
id: note-1
type: journal
date: 2026-06-21
version: 3
---

# 2026-06-21
  id:: heading-1

- [ ] Revisar el date-picker @motor #seguimiento
  id:: task-1
  reminder:: 2026-06-25T07:00:00.000Z
`
  const note = normalizeNote({ filename: '2026-06-21.md', markdown })
  const task = note.blocks.find((block) => block.type === 'task')

  assert.equal(note.id, 'note-1')
  assert.equal(note.version, 3)
  assert.equal(task.id, 'task-1')
  assert.equal(task.reminder, '2026-06-25T07:00:00.000Z')
  assert.match(serializeNote(note), /- \[ \] Revisar el date-picker @motor #seguimiento/)
})

test('clasifica recordatorios vencidos, de hoy y próximos', () => {
  const now = new Date('2026-06-21T12:00:00Z')
  assert.equal(reminderState('2026-06-20T09:00:00Z', now), 'overdue')
  assert.equal(reminderState('2026-06-21T18:00:00Z', now), 'today')
  assert.equal(reminderState('2026-06-22T09:00:00Z', now), 'upcoming')
})

test('conserva el tipo de contexto en Markdown', () => {
  const note = normalizeNote({
    kind: 'context',
    filename: 'sara.md',
    title: 'Sara',
    contextType: 'person',
    blocks: [],
  })

  assert.equal(note.contextType, 'person')
  assert.match(serializeNote(note), /contextType: person/)
})
