import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applySectionContexts,
  cleanHeadingContent,
  contextSlug,
  createBlock,
  dailyTemplate,
  extractContexts,
  extractTags,
  headingEmoji,
  normalizeNote,
  parseMarkdown,
  projectContextBlocks,
  reminderDate,
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

test('migra recordatorios con hora a una fecha de día completo', () => {
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
  assert.equal(task.reminder, '2026-06-25')
  assert.match(serializeNote(note), /reminder:: 2026-06-25/)
  assert.match(serializeNote(note), /- \[ \] Revisar el date-picker @motor #seguimiento/)
})

test('clasifica recordatorios vencidos, de hoy y próximos', () => {
  const now = new Date('2026-06-21T12:00:00Z')
  assert.equal(reminderState('2026-06-20', now), 'overdue')
  assert.equal(reminderState('2026-06-21', now), 'today')
  assert.equal(reminderState('2026-06-22', now), 'upcoming')
})

test('normaliza fechas antiguas sin alterar recordatorios de día completo', () => {
  assert.equal(reminderDate('2026-06-25'), '2026-06-25')
  assert.equal(reminderDate('2026-06-25T07:00:00.000Z'), '2026-06-25')
  assert.equal(reminderDate(null), null)
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

test('limpia el énfasis decorativo de encabezados exportados por Reflect', () => {
  assert.equal(cleanHeadingContent('**🏎️** @motor'), '🏎️ @motor')
  assert.equal(cleanHeadingContent('__🏠__ @hogar'), '🏠 @hogar')

  const parsed = parseMarkdown('## **🏎️** @motor\n- Trabajo en curso')
  assert.equal(parsed.blocks[0].content, '🏎️ @motor')
  assert.doesNotMatch(serializeNote(normalizeNote({ markdown: '## **🏎️** @motor' })), /\*\*/)
  assert.equal(headingEmoji('🏎️ @motor'), '🏎️')
})

test('hereda el contexto del encabezado hasta la siguiente sección', () => {
  const parsed = parseMarkdown(`## **🏎️** @motor
- Preparar swagger
- Revisar mapeos @Ines
## **🍊** @masorange
- Validar integración`)

  assert.deepEqual(parsed.blocks[1].contexts, ['motor'])
  assert.deepEqual(parsed.blocks[2].contexts, ['Ines', 'motor'])
  assert.deepEqual(parsed.blocks[4].contexts, ['masorange'])
})

test('respeta niveles de encabezado al calcular contextos anidados', () => {
  const blocks = applySectionContexts([
    { type: 'heading', level: 2, content: '@motor' },
    { type: 'heading', level: 3, content: '@backend' },
    { type: 'log', content: 'Revisar contrato' },
    { type: 'heading', level: 2, content: '@hogar' },
    { type: 'log', content: 'Validar pantallas' },
  ])

  assert.deepEqual(blocks[2].contexts, ['motor', 'backend'])
  assert.deepEqual(blocks[4].contexts, ['hogar'])
})

test('importa y exporta subitems conservando su nivel Markdown', () => {
  const markdown = `- Elemento principal
  - Subitem
    - [ ] Tarea anidada`
  const parsed = parseMarkdown(markdown)

  assert.equal(parsed.blocks[0].indent, 0)
  assert.equal(parsed.blocks[1].indent, 1)
  assert.equal(parsed.blocks[2].indent, 2)

  const note = normalizeNote({ kind: 'journal', filename: '2026-06-22.md', markdown })
  const serialized = serializeNote(note)
  assert.match(serialized, /^  - Subitem$/m)
  assert.match(serialized, /^    - \[ \] Tarea anidada$/m)
})

test('limita la indentación persistida a seis niveles', () => {
  const note = normalizeNote({
    kind: 'journal',
    blocks: [{ ...createBlock('log', 'Profundo'), indent: 99 }],
  })

  assert.equal(note.blocks[0].indent, 6)
  assert.match(serializeNote(note), /^ {12}- Profundo$/m)
})

test('los subitems heredan el contexto y la identidad de sus padres', () => {
  const parsed = parseMarkdown(`- Seguimiento de validaciones @hogar
  - El web component falla en UAT
    - [ ] Revisar la causa`)
  const [parent, child, grandchild] = parsed.blocks

  assert.deepEqual(child.contexts, ['hogar'])
  assert.equal(child.parentId, parent.id)
  assert.deepEqual(child.ancestorIds, [parent.id])
  assert.deepEqual(grandchild.contexts, ['hogar'])
  assert.equal(grandchild.parentId, child.id)
  assert.deepEqual(grandchild.ancestorIds, [parent.id, child.id])
})

test('la proyección de contexto conserva juntos padres e hijos', () => {
  const parentContext = parseMarkdown(`- Seguimiento @hogar
  - Incidencia sin mención explícita`).blocks
  const inheritedProjection = projectContextBlocks(parentContext, 'hogar')

  assert.equal(inheritedProjection.length, 2)
  assert.deepEqual(inheritedProjection.map((block) => block.contextIndent), [0, 1])

  const childContext = parseMarkdown(`- Conversación general
  - Acuerdo específico @motor`).blocks
  const ancestorProjection = projectContextBlocks(childContext, 'motor')

  assert.equal(ancestorProjection.length, 2)
  assert.deepEqual(ancestorProjection.map((block) => block.contextMatch), [false, true])
  assert.deepEqual(ancestorProjection.map((block) => block.contextIndent), [0, 1])
})

test('guarda prioridades de tarea de forma portable y omite la prioridad base', () => {
  const highTask = normalizeNote({
    kind: 'journal',
    blocks: [{ ...createBlock('task', 'Resolver incidencia'), priority: 'high' }],
  })
  const baseTask = normalizeNote({
    kind: 'journal',
    blocks: [{ ...createBlock('task', 'Revisar documentación'), priority: 'base' }],
  })

  assert.match(serializeNote(highTask), /priority:: high/)
  assert.equal(parseMarkdown(serializeNote(highTask)).blocks[0].priority, 'high')
  assert.doesNotMatch(serializeNote(baseTask), /priority::/)
})

test('normaliza prioridades desconocidas sin duplicar propiedades importadas', () => {
  const note = normalizeNote({
    kind: 'journal',
    markdown: `- [ ] Tarea importada
  priority:: urgent`,
  })

  assert.equal(note.blocks[0].priority, 'base')
  assert.equal(note.blocks[0].properties.priority, undefined)
  assert.doesNotMatch(serializeNote(note), /priority::/)
})
