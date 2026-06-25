import test from 'node:test'
import assert from 'node:assert/strict'
import {
  cloneTemplateBlocks,
  createJournalNote,
  createTemplateEditorNote,
  extractTemplateBlocksFromNote,
  hasMeaningfulTemplateBlocks,
  isBaseJournal,
  normalizeWorkspaceSettings,
  resolveActiveDailyTemplate,
} from '../src/lib/templates.js'
import { createBlock } from '../src/lib/markdown.js'

test('normaliza settings antiguos sin plantilla activa', () => {
  const settings = normalizeWorkspaceSettings({})

  assert.deepEqual(settings.dailyTemplates, [])
  assert.equal(settings.activeDailyTemplateId, null)
})

test('resuelve la plantilla activa aunque falte activeDailyTemplateId', () => {
  const settings = normalizeWorkspaceSettings({
    dailyTemplates: [
      { id: 'base', name: 'Base', blocks: [createBlock('log', 'Aterrizar el día')] },
      { id: 'cierre', name: 'Cierre', blocks: [createBlock('task', 'Cerrar pendientes')] },
    ],
  })

  assert.equal(settings.activeDailyTemplateId, 'base')
  assert.equal(resolveActiveDailyTemplate(settings)?.name, 'Base')
})

test('detecta diarios base y diarios ya intervenidos', () => {
  const base = createJournalNote('2026-06-25')
  const withContent = {
    ...base,
    blocks: [
      base.blocks[0],
      createBlock('log', 'Resumen del día'),
    ],
  }

  assert.equal(isBaseJournal(base), true)
  assert.equal(isBaseJournal(withContent), false)
})

test('el editor de plantilla reintroduce un bloque editable aunque la plantilla esté vacía', () => {
  const note = createTemplateEditorNote({
    id: 'template-1',
    name: 'Diaria',
    blocks: [],
  })

  assert.equal(note.blocks[0].type, 'heading')
  assert.equal(note.blocks[0].level, 1)
  assert.equal(note.blocks[1].type, 'log')
})

test('extrae bloques vacíos como plantilla vacía y conserva bloques con contenido', () => {
  const emptyTemplate = createTemplateEditorNote({ id: 'one', name: 'Vacía', blocks: [] })
  const filledTemplate = createTemplateEditorNote({
    id: 'two',
    name: 'Ritual',
    blocks: [createBlock('task', 'Revisar agenda @equipo #inicio')],
  })

  assert.equal(hasMeaningfulTemplateBlocks(extractTemplateBlocksFromNote(emptyTemplate)), false)
  assert.deepEqual(extractTemplateBlocksFromNote(emptyTemplate), [])
  assert.equal(hasMeaningfulTemplateBlocks(extractTemplateBlocksFromNote(filledTemplate)), true)
  assert.equal(extractTemplateBlocksFromNote(filledTemplate)[0].type, 'task')
})

test('clona bloques de plantilla regenerando ids y relaciones jerárquicas', () => {
  const parent = createBlock('task', 'Tarea raíz')
  const child = {
    ...createBlock('log', 'Subitem'),
    indent: 1,
    parentId: parent.id,
    ancestorIds: [parent.id],
  }

  const cloned = cloneTemplateBlocks([parent, child])

  assert.notEqual(cloned[0].id, parent.id)
  assert.notEqual(cloned[1].id, child.id)
  assert.equal(cloned[1].parentId, cloned[0].id)
  assert.deepEqual(cloned[1].ancestorIds, [cloned[0].id])
})
