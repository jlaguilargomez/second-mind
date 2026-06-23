import test from 'node:test'
import assert from 'node:assert/strict'
import { isTrackingTask } from '../src/lib/taskClassification.js'

test('clasifica como seguimiento solo las tareas delegadas o en espera', () => {
  assert.equal(isTrackingTask({ tags: ['delegado'], contexts: ['Ana'] }), true)
  assert.equal(isTrackingTask({ tags: ['Esperando'], contexts: [] }), true)
  assert.equal(isTrackingTask({ tags: ['follow-up'], contexts: ['Ana'] }), false)
  assert.equal(isTrackingTask({ tags: [], contexts: ['Ana'] }), false)
})
