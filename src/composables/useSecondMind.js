import { computed, ref } from 'vue'
import JSZip from 'jszip'
import {
  contextSlug,
  createBlock,
  createId,
  extractContexts,
  extractTags,
  headingEmoji,
  isoDate,
  normalizeNote,
  reminderDate,
  reminderState,
  serializeNote,
} from '../lib/markdown'
import { LocalRepository } from '../repositories/LocalRepository'
import {
  getDirectoryHandle,
  readWorkspace,
  saveDirectoryHandle,
  verifyPermission,
  writeNote,
} from '../lib/storage'

const LEGACY_LOCAL_KEY = 'second-mind-notes-v1'
const contextPalette = ['sage', 'blue', 'amber', 'violet', 'rose']
const contextEmojis = ['◈', '●', '◆', '✦', '⬡']
export const contextTypes = {
  project: 'Proyecto',
  person: 'Persona',
  team: 'Equipo',
  area: 'Área',
}

function createStarterNotes() {
  const date = isoDate()
  return [
    normalizeNote({
      id: createId(),
      kind: 'journal',
      filename: `${date}.md`,
      date,
      title: date,
      blocks: [
        { ...createBlock('heading', date), level: 1 },
        { ...createBlock('heading', 'Second Mind v2'), level: 2 },
        createBlock('log', 'Los bloques conectan tu trabajo con @producto y #seguimiento.'),
        {
          ...createBlock('task', 'Preparar la primera revisión del día @producto #prioridad'),
          reminder: date,
        },
      ],
    }),
    normalizeNote({
      id: createId(),
      kind: 'context',
      filename: 'producto.md',
      title: 'producto',
      contextType: 'project',
      emoji: '◆',
      color: 'violet',
      blocks: [
        { ...createBlock('heading', 'producto'), level: 1 },
        createBlock('text', 'Contexto de ejemplo para reunir decisiones, actividad y tareas.'),
      ],
    }),
  ]
}

function normalizeImportedNote(note) {
  return normalizeNote({
    ...note,
    id: undefined,
  })
}

export function useSecondMind() {
  const repository = new LocalRepository()
  const notes = ref([])
  const activeNoteId = ref(null)
  const currentView = ref('journal')
  const selectedDate = ref(isoDate())
  const selectedContext = ref(null)
  const loading = ref(true)
  const syncState = ref('Preparando…')
  const directoryHandle = ref(null)
  const workspaceName = ref('Local · offline')
  const conflicts = ref([])
  const notifiedReminders = new Set()
  const saveTimers = new Map()

  const activeNote = computed(() => notes.value.find((note) => note.id === activeNoteId.value))
  const journals = computed(() =>
    notes.value
      .filter((note) => note.kind === 'journal')
      .sort((a, b) => (b.date || '').localeCompare(a.date || '')),
  )
  const contextNotes = computed(() => notes.value.filter((note) => note.kind === 'context'))
  const allBlocks = computed(() =>
    notes.value.flatMap((note) =>
      note.blocks
        .filter((block) => !(block.type === 'heading' && block.level === 1))
        .map((block) => ({
          ...block,
          noteId: note.id,
          noteDate: note.date,
          noteTitle: note.title,
          noteKind: note.kind,
          contexts: block.contexts || extractContexts(block.content),
          tags: extractTags(block.content),
          reminderState: reminderState(block.reminder),
        })),
    ),
  )
  const tasks = computed(() => allBlocks.value.filter((block) => block.type === 'task'))
  const reminders = computed(() =>
    tasks.value
      .filter((block) => block.reminder && !block.checked)
      .sort((a, b) => reminderDate(a.reminder).localeCompare(reminderDate(b.reminder))),
  )
  const contextIndex = computed(() => {
    const index = new Map()
    for (const note of notes.value) {
      for (const block of note.blocks) {
        for (const name of block.contexts || extractContexts(block.content)) {
          const key = name.toLocaleLowerCase()
          const entry = index.get(key) || {
            name,
            count: 0,
            openTasks: 0,
            blocks: [],
          }
          if (block.type === 'heading') {
            entry.emoji ||= headingEmoji(block.content)
            index.set(key, entry)
            continue
          }
          entry.count += 1
          if (block.type === 'task' && !block.checked) entry.openTasks += 1
          entry.blocks.push({ ...block, noteId: note.id, noteDate: note.date })
          index.set(key, entry)
        }
      }
    }
    for (const note of contextNotes.value) {
      const key = note.title.toLocaleLowerCase()
      const entry = index.get(key) || { name: note.title, count: 0, openTasks: 0, blocks: [] }
      Object.assign(entry, {
        noteId: note.id,
        emoji: note.emoji === '◈' && entry.emoji ? entry.emoji : note.emoji,
        color: note.color,
        contextType: note.contextType || 'project',
      })
      index.set(key, entry)
    }
    return [...index.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  })
  const tags = computed(() => {
    const counts = new Map()
    for (const block of allBlocks.value) {
      for (const tag of block.tags) counts.set(tag, (counts.get(tag) || 0) + 1)
    }
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
  })

  async function initialize() {
    await repository.initialize()
    let stored = await repository.listNotes()
    if (!stored.length) {
      const legacy = localStorage.getItem(LEGACY_LOCAL_KEY)
      const initial = legacy
        ? JSON.parse(legacy).map(normalizeImportedNote)
        : createStarterNotes()
      for (const note of initial) await repository.saveNote(note, { enqueue: false })
      stored = initial
      if (legacy) localStorage.removeItem(LEGACY_LOCAL_KEY)
    }
    notes.value = stored.map(normalizeNote)
    await restoreWorkspace()
    await openDate(selectedDate.value)
    loading.value = false
    syncState.value = navigator.onLine ? 'Guardado local' : 'Sin conexión'
    checkDueNotifications()
  }

  function replaceNote(note) {
    const index = notes.value.findIndex((item) => item.id === note.id)
    if (index >= 0) notes.value[index] = note
    else notes.value.push(note)
  }

  async function persistNote(note, { immediate = false } = {}) {
    const execute = async () => {
      const existing = notes.value.find((item) => item.id === note.id)
      const now = new Date().toISOString()
      const saved = normalizeNote({
        ...note,
        markdown: undefined,
        updatedAt: now,
        version: (existing?.version || note.version || 0) + 1,
      })
      saved.markdown = serializeNote(saved)
      replaceNote(saved)
      syncState.value = navigator.onLine ? 'Guardando…' : 'Pendiente de sincronizar'
      try {
        await repository.saveNote(saved, { expectedVersion: saved.version - 1 })
        if (directoryHandle.value) await writeNote(directoryHandle.value, saved)
        syncState.value = navigator.onLine ? 'Guardado local' : 'Pendiente de sincronizar'
      } catch (error) {
        if (error.name === 'VersionConflictError') {
          conflicts.value.push({ local: saved, remote: error.remote })
          syncState.value = 'Conflicto pendiente'
        } else {
          syncState.value = 'Error al guardar'
          throw error
        }
      }
    }

    clearTimeout(saveTimers.get(note.id))
    if (immediate) return execute()
    saveTimers.set(note.id, setTimeout(execute, 350))
  }

  async function openDate(date) {
    selectedDate.value = date
    currentView.value = 'journal'
    let note = journals.value.find((item) => item.date === date)
    if (!note) {
      note = normalizeNote({
        id: createId(),
        kind: 'journal',
        filename: `${date}.md`,
        date,
        title: date,
        blocks: [
          { ...createBlock('heading', date), level: 1 },
          createBlock('log', ''),
        ],
      })
      replaceNote(note)
      await persistNote(note, { immediate: true })
    }
    activeNoteId.value = note.id
  }

  function setView(view) {
    currentView.value = view
    selectedContext.value = null
  }

  async function openContext(name, options = {}) {
    const key = name.toLocaleLowerCase()
    let note = contextNotes.value.find((item) => item.title.toLocaleLowerCase() === key)
    if (!note) {
      const index = contextNotes.value.length
      const indexedContext = contextIndex.value.find(
        (context) => context.name.toLocaleLowerCase() === key,
      )
      note = normalizeNote({
        id: createId(),
        kind: 'context',
        filename: `${contextSlug(name) || 'contexto'}.md`,
        title: name,
        contextType: options.contextType || 'project',
        emoji: indexedContext?.emoji || contextEmojis[index % contextEmojis.length],
        color: contextPalette[index % contextPalette.length],
        blocks: [
          { ...createBlock('heading', name), level: 1 },
          createBlock('text', ''),
        ],
      })
      replaceNote(note)
      await persistNote(note, { immediate: true })
    }
    activeNoteId.value = note.id
    selectedContext.value = name
    currentView.value = 'context'
  }

  function updateContext(noteId, patch) {
    const note = notes.value.find((item) => item.id === noteId && item.kind === 'context')
    if (!note) return
    const updated = normalizeNote({ ...note, ...patch, markdown: undefined })
    replaceNote(updated)
    persistNote(updated)
  }

  function updateBlock(noteId, blockId, patch) {
    const note = notes.value.find((item) => item.id === noteId)
    if (!note) return
    const blocks = note.blocks.map((block) =>
      block.id === blockId
        ? { ...block, ...patch, updatedAt: new Date().toISOString() }
        : block,
    )
    const updated = normalizeNote({ ...note, blocks, markdown: undefined })
    replaceNote(updated)
    persistNote(updated)
  }

  function addBlock(noteId, afterBlockId, type = 'log', content = '', options = {}) {
    const note = notes.value.find((item) => item.id === noteId)
    if (!note) return null
    const block = { ...createBlock(type, content), ...options }
    const index = note.blocks.findIndex((item) => item.id === afterBlockId)
    const blocks = [...note.blocks]
    blocks.splice(index < 0 ? blocks.length : index + 1, 0, block)
    const updated = normalizeNote({ ...note, blocks, markdown: undefined })
    replaceNote(updated)
    persistNote(updated)
    return block
  }

  function removeBlock(noteId, blockId) {
    const note = notes.value.find((item) => item.id === noteId)
    if (!note || note.blocks.length <= 1) return
    const updated = normalizeNote({
      ...note,
      markdown: undefined,
      blocks: note.blocks.filter((block) => block.id !== blockId),
    })
    replaceNote(updated)
    persistNote(updated)
  }

  function changeBlockType(noteId, blockId, type) {
    updateBlock(noteId, blockId, {
      type,
      checked: type === 'task' ? false : undefined,
      level: type === 'heading' ? 2 : undefined,
    })
  }

  async function importFiles(files) {
    for (const file of files) {
      if (file.name.toLowerCase().endsWith('.zip')) {
        const archive = await JSZip.loadAsync(file)
        const entries = Object.values(archive.files).filter(
          (entry) => !entry.dir && entry.name.toLowerCase().endsWith('.md'),
        )
        for (const entry of entries) {
          const filename = entry.name.split('/').pop()
          const markdown = await entry.async('string')
          await importMarkdown(filename, markdown, Date.now())
        }
        continue
      }
      if (!file.name.toLowerCase().endsWith('.md')) continue
      await importMarkdown(file.name, await file.text(), file.lastModified)
    }
    await openDate(journals.value[0]?.date || isoDate())
  }

  async function importMarkdown(filename, markdown, lastModified) {
    const date = filename.match(/\d{4}-\d{2}-\d{2}/)?.[0] || null
    const note = normalizeNote({
      id: undefined,
      kind: date ? 'journal' : 'context',
      filename,
      date,
      markdown,
      updatedAt: new Date(lastModified || Date.now()).toISOString(),
    })
    replaceNote(note)
    await repository.saveNote(note)
    if (directoryHandle.value) await writeNote(directoryHandle.value, note)
  }

  async function connectWorkspace() {
    if (!window.showDirectoryPicker) throw new Error('Este navegador no permite abrir carpetas.')
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' })
    await saveDirectoryHandle(handle)
    directoryHandle.value = handle
    workspaceName.value = handle.name
    const diskNotes = await readWorkspace(handle)
    for (const diskNote of diskNotes) {
      const note = normalizeImportedNote(diskNote)
      replaceNote(note)
      await repository.saveNote(note)
    }
    for (const note of notes.value) await writeNote(handle, note)
  }

  async function restoreWorkspace() {
    try {
      const handle = await getDirectoryHandle()
      if (handle && (await verifyPermission(handle, true))) {
        directoryHandle.value = handle
        workspaceName.value = handle.name
      }
    } catch {
      // IndexedDB remains the source of truth when folder permission is unavailable.
    }
  }

  async function requestNotificationPermission() {
    if (!('Notification' in window)) return 'unsupported'
    return Notification.requestPermission()
  }

  function checkDueNotifications() {
    if (!('Notification' in window) || Notification.permission !== 'granted') return
    const today = isoDate()
    for (const block of reminders.value) {
      if (reminderDate(block.reminder) > today || notifiedReminders.has(block.id)) continue
      notifiedReminders.add(block.id)
      new Notification('Second Mind', {
        body: block.content || 'Tienes un recordatorio pendiente',
        icon: `${import.meta.env.BASE_URL}pwa-192x192.png`,
        tag: block.id,
      })
    }
  }

  function openBlock(block) {
    activeNoteId.value = block.noteId
    if (block.noteDate) {
      selectedDate.value = block.noteDate
      currentView.value = 'journal'
    }
  }

  function getContext(name) {
    return contextIndex.value.find((context) => context.name.toLocaleLowerCase() === name.toLocaleLowerCase())
  }

  function contextBlocks(name) {
    const key = name.toLocaleLowerCase()
    return allBlocks.value.filter(
      (block) =>
        block.type !== 'heading' &&
        block.contexts.some((context) => context.toLocaleLowerCase() === key),
    )
  }

  function search(query) {
    const term = query.trim().toLocaleLowerCase()
    if (!term) return []
    return allBlocks.value
      .filter((block) =>
        `${block.content} ${block.noteTitle} ${block.noteDate}`.toLocaleLowerCase().includes(term),
      )
      .slice(0, 20)
  }

  window.addEventListener('online', () => {
    syncState.value = 'Guardado local'
    checkDueNotifications()
  })
  window.addEventListener('offline', () => {
    syncState.value = 'Sin conexión'
  })

  return {
    repository,
    notes,
    journals,
    activeNote,
    activeNoteId,
    currentView,
    selectedDate,
    selectedContext,
    loading,
    syncState,
    workspaceName,
    conflicts,
    allBlocks,
    tasks,
    reminders,
    contextIndex,
    tags,
    initialize,
    openDate,
    setView,
    openContext,
    updateContext,
    updateBlock,
    addBlock,
    removeBlock,
    changeBlockType,
    importFiles,
    connectWorkspace,
    requestNotificationPermission,
    checkDueNotifications,
    openBlock,
    getContext,
    contextBlocks,
    search,
  }
}
