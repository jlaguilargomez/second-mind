import test from 'node:test'
import assert from 'node:assert/strict'
import { buildAssistantContext } from '../src/lib/assistantContext.js'

function block(id, type, content, extra = {}) {
  return { id, type, content, contexts: [], tags: [], priority: 'base', ...extra }
}

const notes = [
  {
    id: 'old',
    kind: 'journal',
    date: '2026-06-01',
    title: '2026-06-01',
    blocks: [
      block('old-open', 'task', 'Tarea antigua abierta', { priority: 'high' }),
      block('old-done', 'task', 'Tarea antigua terminada', { checked: true }),
      block('old-log', 'log', 'Log demasiado antiguo'),
    ],
  },
  {
    id: 'recent',
    kind: 'journal',
    date: '2026-06-14',
    title: '2026-06-14',
    blocks: [
      block('waiting', 'task', 'Esperar respuesta @Ana #esperando', {
        contexts: ['Ana'],
        tags: ['esperando'],
      }),
      block('recent-done', 'task', 'Trabajo terminado', { checked: true }),
      block('recent-log', 'log', 'Decisión reciente #producto', { tags: ['producto'] }),
    ],
  },
]

test('incluye tareas abiertas antiguas y limita completadas y logs al periodo', () => {
  const context = buildAssistantContext(notes, { today: '2026-06-14', periodDays: 7 })
  assert.deepEqual(context.sources.map((source) => source.blockId), [
    'old-open',
    'waiting',
    'recent-done',
    'recent-log',
  ])
  assert.equal(context.since, '2026-06-08')
  assert.equal(context.counts.openTasks, 1)
  assert.equal(context.counts.tracking, 1)
})

test('clasifica seguimiento y conserva metadatos navegables', () => {
  const context = buildAssistantContext(notes, { today: '2026-06-14', periodDays: 14 })
  const waiting = context.sources.find((source) => source.blockId === 'waiting')
  assert.equal(waiting.category, 'tracking')
  assert.equal(waiting.noteId, 'recent')
  assert.deepEqual(waiting.contexts, ['Ana'])
  assert.deepEqual(waiting.tags, ['esperando'])
})

test('trunca de forma determinista manteniendo primero las tareas abiertas', () => {
  const first = buildAssistantContext(notes, {
    today: '2026-06-14',
    periodDays: 30,
    characterBudget: 1000,
  })
  const second = buildAssistantContext(notes, {
    today: '2026-06-14',
    periodDays: 30,
    characterBudget: 1000,
  })
  assert.deepEqual(first.sources, second.sources)
  assert.equal(first.sources[0].blockId, 'old-open')
})
