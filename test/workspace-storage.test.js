import test from 'node:test'
import assert from 'node:assert/strict'
import { readWorkspace } from '../src/lib/storage.js'

class FakeFileHandle {
  constructor(name, content, lastModified = Date.now()) {
    this.kind = 'file'
    this.name = name
    this.content = content
    this.lastModified = lastModified
  }

  async getFile() {
    return {
      lastModified: this.lastModified,
      text: async () => this.content,
    }
  }
}

class FakeDirectoryHandle {
  constructor(entries = {}) {
    this.kind = 'directory'
    this.entriesMap = new Map(Object.entries(entries))
  }

  async getDirectoryHandle(name) {
    const entry = this.entriesMap.get(name)
    if (!entry || entry.kind !== 'directory') {
      const error = new Error(`Missing directory: ${name}`)
      error.name = 'NotFoundError'
      throw error
    }
    return entry
  }

  async getFileHandle(name) {
    const entry = this.entriesMap.get(name)
    if (!entry || entry.kind !== 'file') {
      const error = new Error(`Missing file: ${name}`)
      error.name = 'NotFoundError'
      throw error
    }
    return entry
  }

  async *entries() {
    for (const entry of this.entriesMap.entries()) yield entry
  }
}

test('readWorkspace devuelve diarios con kind singular para que sobrevivan a la recarga', async () => {
  const workspace = new FakeDirectoryHandle({
    'second-mind.json': new FakeFileHandle('second-mind.json', JSON.stringify({ format: 'second-mind-v2' })),
    journals: new FakeDirectoryHandle({
      '2026-07-14.md': new FakeFileHandle(
        '2026-07-14.md',
        '---\ntype: journal\ndate: 2026-07-14\n---\n\n# 2026-07-14\n\n- Hola\n',
      ),
    }),
    contexts: new FakeDirectoryHandle({
      'producto.md': new FakeFileHandle(
        'producto.md',
        '---\ntype: context\nname: producto\n---\n\n# producto\n',
      ),
    }),
  })

  const notes = await readWorkspace(workspace)
  const journal = notes.find((note) => note.filename === '2026-07-14.md')
  const context = notes.find((note) => note.filename === 'producto.md')

  assert.ok(journal)
  assert.equal(journal.kind, 'journal')
  assert.equal(context.kind, 'context')
  assert.deepEqual(notes.workspaceManifest, { format: 'second-mind-v2' })
})
