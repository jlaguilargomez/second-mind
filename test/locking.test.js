import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createBlock, normalizeNote } from '../src/lib/markdown.js'
import { useSecondMind } from '../src/composables/useSecondMind.js'

if (!globalThis.window) {
  globalThis.window = { addEventListener() {}, clearTimeout, setTimeout }
}
if (!globalThis.navigator) {
  globalThis.navigator = { onLine: true }
}

function journalNote({ id, content, locked = false }) {
  return normalizeNote({
    id,
    kind: 'journal',
    filename: '2026-09-14.md',
    date: '2026-09-14',
    title: '2026-09-14',
    locked,
    blocks: [
      { ...createBlock('heading', '2026-09-14'), level: 1 },
      createBlock('task', content),
    ],
  })
}

test('el bloqueo se conserva en Markdown y las notas antiguas siguen desbloqueadas', () => {
  const locked = journalNote({ id: 'locked-journal', content: 'Cerrar el día', locked: true })
  const roundTrip = normalizeNote({ filename: locked.filename, markdown: locked.markdown })
  const legacy = normalizeNote({
    filename: '2026-09-13.md',
    markdown: '# 2026-09-13\n\n- Entrada antigua\n',
  })

  assert.equal(locked.locked, true)
  assert.match(locked.markdown, /^locked: true$/m)
  assert.equal(roundTrip.locked, true)
  assert.equal(legacy.locked, false)
  assert.doesNotMatch(legacy.markdown, /^locked:/m)

  const context = normalizeNote({
    kind: 'context',
    filename: 'proyecto.md',
    markdown: '---\ntype: context\nlocked: true\n---\n\n# Proyecto\n',
  })
  assert.equal(context.locked, false)
})

test('bloquear integra el último cambio pendiente y solo permite marcar tareas', async () => {
  const mind = useSecondMind()
  const journal = journalNote({ id: 'journal-1', content: 'Versión inicial' })
  const independent = normalizeNote({
    id: 'note-1',
    kind: 'note',
    filename: 'cerrada.md',
    title: 'Cerrada',
    locked: true,
    blocks: [
      { ...createBlock('heading', 'Cerrada'), level: 1 },
      createBlock('log', 'Contenido final'),
    ],
  })
  const saved = []
  mind.repository.saveNote = async (note) => {
    saved.push(note)
    return note
  }
  mind.notes.value = [journal, independent]

  const taskId = journal.blocks[1].id
  assert.equal(mind.updateBlock(journal.id, taskId, { content: 'Versión final' }), true)
  const locked = await mind.setNoteLocked(journal.id, true)

  assert.equal(locked.locked, true)
  assert.equal(locked.blocks[1].content, 'Versión final')
  assert.equal(locked.version, journal.version + 1)
  assert.equal(saved.length, 1)
  assert.equal(mind.allBlocks.value.find((block) => block.id === taskId).noteLocked, true)
  assert.equal(mind.updateBlock(journal.id, taskId, { checked: true }), true)
  assert.equal(mind.notes.value.find((note) => note.id === journal.id).blocks[1].checked, true)
  assert.equal(mind.updateBlock(journal.id, taskId, { content: 'Cambio bloqueado' }), false)
  assert.equal(mind.addBlock(journal.id, taskId), null)
  assert.equal(mind.removeBlock(journal.id, taskId), false)
  assert.equal(await mind.applyDailyTemplate(journal.id), false)
  assert.equal(await mind.renameNote(independent.id, 'Otro título'), null)
  assert.equal(await mind.deleteNote(independent.id), false)

  const unlocked = await mind.setNoteLocked(journal.id, false)
  assert.equal(unlocked.locked, false)
  assert.doesNotMatch(unlocked.markdown, /^locked:/m)
})

test('renombrar contextos no reescribe menciones dentro de días bloqueados', async () => {
  const mind = useSecondMind()
  const lockedJournal = journalNote({ id: 'journal-locked', content: 'Revisar con @Motor', locked: true })
  const context = normalizeNote({
    id: 'context-1',
    kind: 'context',
    filename: 'motor.md',
    title: 'Motor',
    blocks: [{ ...createBlock('heading', 'Motor'), level: 1 }],
  })
  mind.repository.saveNote = async (note) => note
  mind.notes.value = [lockedJournal, context]

  await mind.renameContext('Motor', 'Propulsión')

  assert.equal(mind.notes.value.find((note) => note.id === lockedJournal.id).blocks[1].content, 'Revisar con @Motor')
  assert.equal(mind.notes.value.find((note) => note.id === context.id).title, 'Propulsión')
})

test('eliminar etiquetas conserva sus menciones dentro de días bloqueados', async () => {
  const mind = useSecondMind()
  const lockedJournal = journalNote({ id: 'journal-tag-locked', content: 'Cierre #final', locked: true })
  const tag = normalizeNote({
    id: 'tag-1',
    kind: 'tag',
    filename: 'final.md',
    title: 'final',
    blocks: [{ ...createBlock('heading', 'final'), level: 1 }],
  })
  mind.repository.deleteNote = async () => undefined
  mind.notes.value = [lockedJournal, tag]

  await mind.deleteTag('final')

  assert.equal(mind.notes.value.find((note) => note.id === lockedJournal.id).blocks[1].content, 'Cierre #final')
  assert.equal(mind.notes.value.some((note) => note.id === tag.id), false)
})

test('la interfaz expone solo lectura y desactiva acciones indirectas', async () => {
  const [app, editor, styles] = await Promise.all([
    readFile(new URL('../src/App.vue', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/BlockEditor.vue', import.meta.url), 'utf8'),
    readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
  ])

  assert.match(app, /function toggleActiveNoteLock\(\)/)
  assert.match(app, /window\.confirm\(`¿Desbloquear/)
  assert.match(app, /:read-only="activeNote\.locked"/)
  assert.match(app, /:readonly="activeNote\.locked"/)
  assert.match(app, /class="reminder-button"\s+:disabled="task\.noteLocked"/)
  assert.match(app, /class="note-lock-badge"/)
  assert.match(editor, /readOnly: \{ type: Boolean, default: false \}/)
  assert.match(editor, /v-if="!readOnly"\s+class="add-entry-button"/)
  assert.match(editor, /if \(props\.readOnly\) return/)
  assert.doesNotMatch(editor, /class="task-toggle"\s+:disabled="readOnly"/)
  assert.match(styles, /\.lock-toggle-button/)
  assert.match(styles, /\.block-editor\.read-only/)
})
