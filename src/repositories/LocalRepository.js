import { NotesRepository } from './NotesRepository'

const DB_NAME = 'second-mind-v2'
const DB_VERSION = 1
const NOTES_STORE = 'notes'
const OPERATIONS_STORE = 'operations'
const SETTINGS_STORE = 'settings'

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = resolve
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
}

export class LocalRepository extends NotesRepository {
  constructor() {
    super()
    this.db = null
  }

  async initialize() {
    if (this.db) return
    this.db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(NOTES_STORE)) {
          const store = db.createObjectStore(NOTES_STORE, { keyPath: 'id' })
          store.createIndex('kind', 'kind')
          store.createIndex('date', 'date')
          store.createIndex('updatedAt', 'updatedAt')
        }
        if (!db.objectStoreNames.contains(OPERATIONS_STORE)) {
          const store = db.createObjectStore(OPERATIONS_STORE, { keyPath: 'operationId' })
          store.createIndex('createdAt', 'createdAt')
        }
        if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
          db.createObjectStore(SETTINGS_STORE, { keyPath: 'key' })
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }

  async listNotes() {
    await this.initialize()
    const notes = await requestResult(this.db.transaction(NOTES_STORE).objectStore(NOTES_STORE).getAll())
    return notes.filter((note) => !note.deletedAt)
  }

  async getNote(id) {
    await this.initialize()
    return requestResult(this.db.transaction(NOTES_STORE).objectStore(NOTES_STORE).get(id))
  }

  async saveNote(note, options = {}) {
    await this.initialize()
    const transaction = this.db.transaction([NOTES_STORE, OPERATIONS_STORE], 'readwrite')
    const notesStore = transaction.objectStore(NOTES_STORE)
    const existing = await requestResult(notesStore.get(note.id))

    if (
      options.expectedVersion !== undefined &&
      existing &&
      existing.version !== options.expectedVersion
    ) {
      const error = new Error('La nota ha cambiado en otro dispositivo.')
      error.name = 'VersionConflictError'
      error.local = note
      error.remote = existing
      throw error
    }

    notesStore.put(note)
    if (options.enqueue !== false) {
      transaction.objectStore(OPERATIONS_STORE).put({
        operationId: crypto.randomUUID(),
        entityId: note.id,
        type: 'upsert',
        version: note.version,
        payload: note.markdown,
        createdAt: new Date().toISOString(),
      })
    }
    await transactionDone(transaction)
    return note
  }

  async saveNotes(notes, options = {}) {
    await this.initialize()
    const transaction = this.db.transaction([NOTES_STORE, OPERATIONS_STORE], 'readwrite')
    const notesStore = transaction.objectStore(NOTES_STORE)
    const operationsStore = transaction.objectStore(OPERATIONS_STORE)
    const createdAt = new Date().toISOString()

    for (const note of notes) {
      notesStore.put(note)
      if (options.enqueue !== false) {
        operationsStore.put({
          operationId: crypto.randomUUID(),
          entityId: note.id,
          type: 'upsert',
          version: note.version,
          payload: note.markdown,
          createdAt,
        })
      }
    }

    await transactionDone(transaction)
    return notes
  }

  async deleteNote(id) {
    await this.initialize()
    const note = await this.getNote(id)
    if (!note) return
    const deletedAt = new Date().toISOString()
    const deletedNote = {
      ...note,
      deletedAt,
      updatedAt: deletedAt,
      version: note.version + 1,
    }
    const transaction = this.db.transaction([NOTES_STORE, OPERATIONS_STORE], 'readwrite')
    transaction.objectStore(NOTES_STORE).put(deletedNote)
    transaction.objectStore(OPERATIONS_STORE).put({
      operationId: crypto.randomUUID(),
      entityId: note.id,
      type: 'delete',
      version: deletedNote.version,
      payload: null,
      createdAt: deletedAt,
    })
    await transactionDone(transaction)
  }

  async listOperations() {
    await this.initialize()
    return requestResult(
      this.db.transaction(OPERATIONS_STORE).objectStore(OPERATIONS_STORE).getAll(),
    )
  }

  async acknowledgeOperations(operationIds) {
    await this.initialize()
    const transaction = this.db.transaction(OPERATIONS_STORE, 'readwrite')
    const store = transaction.objectStore(OPERATIONS_STORE)
    for (const id of operationIds) store.delete(id)
    await transactionDone(transaction)
  }

  async replaceAllNotes(notes) {
    await this.initialize()
    const transaction = this.db.transaction([NOTES_STORE, OPERATIONS_STORE], 'readwrite')
    const notesStore = transaction.objectStore(NOTES_STORE)
    notesStore.clear()
    transaction.objectStore(OPERATIONS_STORE).clear()
    for (const note of notes) notesStore.put(note)
    await transactionDone(transaction)
  }

  async getSetting(key) {
    await this.initialize()
    return requestResult(this.db.transaction(SETTINGS_STORE).objectStore(SETTINGS_STORE).get(key))
  }

  async setSetting(key, value) {
    await this.initialize()
    const transaction = this.db.transaction(SETTINGS_STORE, 'readwrite')
    transaction.objectStore(SETTINGS_STORE).put({ key, value })
    await transactionDone(transaction)
  }
}
