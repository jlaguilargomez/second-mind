import { computed, ref } from 'vue'
import JSZip from 'jszip'
import {
  contextSlug,
  createBlock,
  createId,
  DEFAULT_CONTEXT_TYPE,
  extractContexts,
  extractTags,
  headingEmoji,
  isoDate,
  normalizeNote,
  projectContextBlocks,
  reminderDate,
  reminderState,
  replaceContextReference,
  removeContextReference,
  removeTagReference,
  serializeNote,
  sortContextBlocksByDate,
} from '../lib/markdown'
import {
  cloneTemplateBlocks,
  createDefaultWorkspaceSettings,
  createJournalNote,
  createTemplateEditorNote,
  extractTemplateBlocksFromNote,
  isBaseJournal,
  normalizeWorkspaceSettings,
  resolveActiveDailyTemplate,
  WORKSPACE_SETTINGS_KEY,
} from '../lib/templates'
import { LocalRepository } from '../repositories/LocalRepository'
import {
  getDirectoryHandle,
  readMarkdownTree,
  readWorkspace,
  readWorkspaceManifest,
  removeNote,
  saveDirectoryHandle,
  verifyPermission,
  writeNote,
  writeWorkspaceManifest,
} from '../lib/storage'

const LEGACY_LOCAL_KEY = 'second-mind-notes-v1'
const THEME_PREFERENCE_KEY = 'second-mind-theme'
const WORKSPACE_RECOVERY_KEY = 'workspace-recovery'
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
      ...createJournalNote(date),
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

function importIdentity(note) {
  if (note.kind === 'journal') return `journal:${note.date || note.filename}`
  if (note.kind === 'tag') return `tag:${note.title.toLocaleLowerCase()}`
  return `context:${note.title.toLocaleLowerCase()}`
}

function noteSnapshotFingerprint(note) {
  const normalized = normalizeImportedNote(note)
  return JSON.stringify({
    identity: importIdentity(normalized),
    kind: normalized.kind,
    filename: normalized.filename,
    date: normalized.date,
    title: normalized.title,
    markdown: normalized.markdown,
    emoji: normalized.emoji,
    color: normalized.color,
    contextType: normalized.contextType,
    description: normalized.description || '',
  })
}

function cloneForStorage(value) {
  if (value == null) return value
  return JSON.parse(JSON.stringify(value))
}

export function useSecondMind() {
  const repository = new LocalRepository()
  const notes = ref([])
  const workspaceSettings = ref(createDefaultWorkspaceSettings())
  const activeNoteId = ref(null)
  const currentView = ref('journal')
  const selectedDate = ref(isoDate())
  const selectedContext = ref(null)
  const loading = ref(true)
  const syncState = ref('Preparando…')
  const directoryHandle = ref(null)
  const workspaceName = ref('Local sin carpeta')
  const workspacePersistence = ref('none')
  const recoverySnapshots = ref([])
  const conflicts = ref([])
  const notifiedReminders = new Set()
  const saveTimers = new Map()
  let hasPendingLocalImport = false

  function settledSyncState() {
    if (directoryHandle.value) return 'Guardado en carpeta'
    return navigator.onLine ? 'Modo local sin carpeta' : 'Sin conexión · modo local'
  }

  const workspacePersistenceLabel = computed(() => {
    if (!directoryHandle.value) return 'Sin carpeta conectada'
    if (workspacePersistence.value === 'persisted') return 'Carpeta restaurable'
    return 'Solo esta sesión'
  })

  const activeNote = computed(() => notes.value.find((note) => note.id === activeNoteId.value))
  const dailyTemplates = computed(() => workspaceSettings.value.dailyTemplates || [])
  const activeDailyTemplateId = computed(() => workspaceSettings.value.activeDailyTemplateId || null)
  const activeDailyTemplate = computed(() => resolveActiveDailyTemplate(workspaceSettings.value))
  const theme = computed(() => workspaceSettings.value.theme === 'light' ? 'light' : 'dark')
  const journals = computed(() =>
    notes.value
      .filter((note) => note.kind === 'journal')
      .sort((a, b) => (b.date || '').localeCompare(a.date || '')),
  )
  const contextNotes = computed(() => notes.value.filter((note) => note.kind === 'context'))
  const tagNotes = computed(() => notes.value.filter((note) => note.kind === 'tag'))
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
          tags: block.tags || extractTags(block.content),
          inheritedTags: block.inheritedTags || [],
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
          entry.blocks.push({ ...block, noteId: note.id, noteDate: note.date, noteTitle: note.title })
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
        contextType: note.contextType || DEFAULT_CONTEXT_TYPE,
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
    const index = new Map(
      [...counts.entries()].map(([name, count]) => [
        name.toLocaleLowerCase(),
        { name, count, description: '', noteId: null },
      ]),
    )
    for (const note of tagNotes.value) {
      const key = note.title.toLocaleLowerCase()
      const existing = index.get(key) || {
        name: note.title,
        count: 0,
        description: '',
        noteId: null,
      }
      index.set(key, {
        ...existing,
        name: note.title,
        description: note.description || '',
        noteId: note.id,
      })
    }
    return [...index.values()]
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  })

  function createWorkspaceManifest() {
    return {
      exportedAt: new Date().toISOString(),
      format: 'second-mind-v2',
      noteCount: notes.value.length,
      settings: workspaceSettings.value,
    }
  }

  function hasWorkspaceDifferences(currentNotes, diskNotes) {
    const currentEntries = currentNotes.map(noteSnapshotFingerprint).sort()
    const diskEntries = diskNotes.map(noteSnapshotFingerprint).sort()
    if (currentEntries.length !== diskEntries.length) return true
    return currentEntries.some((entry, index) => entry !== diskEntries[index])
  }

  function hasSettingsDifferences(manifest = null) {
    const currentSettings = normalizeWorkspaceSettings(workspaceSettings.value)
    const nextSettings = normalizeWorkspaceSettings({
      ...currentSettings,
      ...(manifest?.settings || {}),
    })
    return JSON.stringify(currentSettings) !== JSON.stringify(nextSettings)
  }

  async function persistRecoverySnapshot(reason, diskNotes = []) {
    const stored = await repository.getSetting(WORKSPACE_RECOVERY_KEY)
    const existingSnapshots = Array.isArray(stored?.value?.snapshots)
      ? stored.value.snapshots
      : Array.isArray(stored?.snapshots)
        ? stored.snapshots
        : []
    const snapshot = {
      id: createId(),
      createdAt: new Date().toISOString(),
      reason,
      workspaceName: workspaceName.value,
      notes: cloneForStorage(notes.value.map((note) => normalizeNote(note))),
      settings: cloneForStorage(normalizeWorkspaceSettings(workspaceSettings.value)),
      noteCount: notes.value.length,
      diskNoteCount: diskNotes.length,
    }
    recoverySnapshots.value = cloneForStorage([snapshot, ...existingSnapshots].slice(0, 3))
    await repository.setSetting(WORKSPACE_RECOVERY_KEY, {
      snapshots: cloneForStorage(recoverySnapshots.value),
    })
  }

  async function safeguardWorkspaceReplacement(diskNotes, reason) {
    if (!notes.value.length) return false
    const needsSnapshot = hasWorkspaceDifferences(notes.value, diskNotes)
      || hasSettingsDifferences(diskNotes.workspaceManifest)
    if (!needsSnapshot) return false
    await persistRecoverySnapshot(reason, diskNotes)
    return true
  }

  async function loadSavedSettings() {
    const stored = await repository.getSetting(WORKSPACE_SETTINGS_KEY)
    const recovery = await repository.getSetting(WORKSPACE_RECOVERY_KEY)
    const storedTheme = localStorage.getItem(THEME_PREFERENCE_KEY)
    workspaceSettings.value = normalizeWorkspaceSettings({
      ...(stored?.value || stored || {}),
      theme: storedTheme === 'light' ? 'light' : storedTheme === 'dark' ? 'dark' : stored?.value?.theme,
    })
    recoverySnapshots.value = Array.isArray(recovery?.value?.snapshots)
      ? recovery.value.snapshots
      : Array.isArray(recovery?.snapshots)
        ? recovery.snapshots
        : []
  }

  async function persistWorkspaceSettings() {
    workspaceSettings.value = normalizeWorkspaceSettings(workspaceSettings.value)
    localStorage.setItem(THEME_PREFERENCE_KEY, workspaceSettings.value.theme)
    await repository.setSetting(WORKSPACE_SETTINGS_KEY, cloneForStorage(workspaceSettings.value))
    if (directoryHandle.value) {
      await writeWorkspaceManifest(directoryHandle.value, createWorkspaceManifest())
    }
  }

  async function applyWorkspaceManifest(manifest = null) {
    workspaceSettings.value = normalizeWorkspaceSettings({
      ...workspaceSettings.value,
      ...(manifest?.settings || {}),
    })
    localStorage.setItem(THEME_PREFERENCE_KEY, workspaceSettings.value.theme)
    await repository.setSetting(WORKSPACE_SETTINGS_KEY, cloneForStorage(workspaceSettings.value))
  }

  async function setTheme(nextTheme) {
    workspaceSettings.value = normalizeWorkspaceSettings({
      ...workspaceSettings.value,
      theme: nextTheme === 'light' ? 'light' : 'dark',
    })
    await persistWorkspaceSettings()
  }

  async function toggleTheme() {
    await setTheme(theme.value === 'dark' ? 'light' : 'dark')
  }

  async function initialize() {
    await repository.initialize()
    await loadSavedSettings()
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
    const workspaceRestored = await restoreWorkspace()
    if (workspaceRestored) await loadWorkspaceFromDisk()
    if (workspaceRestored) await activateFirstAvailableNote({ createJournal: false })
    else await openDate(selectedDate.value)
    loading.value = false
    syncState.value = settledSyncState()
    checkDueNotifications()
  }

  function replaceNote(note) {
    const index = notes.value.findIndex((item) => item.id === note.id)
    if (index >= 0) notes.value[index] = note
    else notes.value.push(note)
  }

  function replaceNotes(updatedNotes) {
    if (!updatedNotes.length) return
    const updates = new Map(updatedNotes.map((note) => [note.id, note]))
    const existingIds = new Set(notes.value.map((note) => note.id))
    notes.value = [
      ...notes.value.map((note) => updates.get(note.id) || note),
      ...updatedNotes.filter((note) => !existingIds.has(note.id)),
    ]
  }

  async function applyWorkspaceNotes(diskNotes, options = {}) {
    if (options.createRecoverySnapshot !== false) {
      await safeguardWorkspaceReplacement(diskNotes, options.reason || 'workspace-reload')
    }
    for (const timer of saveTimers.values()) clearTimeout(timer)
    saveTimers.clear()
    const workspaceNotes = diskNotes.map((note) => normalizeImportedNote(note))
    notes.value = workspaceNotes
    await repository.replaceAllNotes(workspaceNotes)
    return workspaceNotes
  }

  async function loadWorkspaceFromDisk() {
    if (!directoryHandle.value) return []
    syncState.value = 'Recargando carpeta…'
    const diskNotes = await readWorkspace(directoryHandle.value)
    const workspaceNotes = await applyWorkspaceNotes(diskNotes, {
      reason: 'reload-from-disk',
    })
    await applyWorkspaceManifest(diskNotes.workspaceManifest)
    syncState.value = settledSyncState()
    return workspaceNotes
  }

  function prepareNoteForSave(note, expectedVersion) {
    const now = new Date().toISOString()
    const saved = normalizeNote({
      ...note,
      markdown: undefined,
      updatedAt: now,
      version: (expectedVersion ?? note.version ?? 0) + 1,
    })
    saved.markdown = serializeNote(saved)
    return { saved, expectedVersion: expectedVersion ?? 0 }
  }

  async function savePreparedNote(saved, expectedVersion, options = {}) {
    syncState.value = directoryHandle.value ? 'Guardando en carpeta…' : 'Guardando local…'
    try {
      await repository.saveNote(saved, { expectedVersion })
      if (directoryHandle.value) {
        await writeNote(directoryHandle.value, saved)
        if (
          options.removeStaleFile &&
          options.removeStaleFile.filename &&
          options.removeStaleFile.filename !== saved.filename
        ) {
          try {
            await removeNote(directoryHandle.value, options.removeStaleFile)
          } catch (error) {
            if (error.name !== 'NotFoundError') throw error
          }
        }
      }
      syncState.value = settledSyncState()
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

  async function persistNote(note, { immediate = false } = {}) {
    const execute = async () => {
      const existing = notes.value.find((item) => item.id === note.id)
      const { saved, expectedVersion } = prepareNoteForSave(note, existing?.version || note.version)
      replaceNote(saved)
      await savePreparedNote(saved, expectedVersion)
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
      note = createJournalNote(date)
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
        contextType: options.contextType || DEFAULT_CONTEXT_TYPE,
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

  async function activateFirstAvailableNote({ createJournal = true } = {}) {
    const firstJournal = journals.value[0]
    if (firstJournal) {
      await openDate(firstJournal.date || selectedDate.value)
      return
    }

    const firstContext = contextNotes.value[0]
    if (firstContext) {
      activeNoteId.value = firstContext.id
      selectedContext.value = firstContext.title
      currentView.value = 'context'
      return
    }

    const firstTag = tagNotes.value[0]
    if (firstTag) {
      activeNoteId.value = firstTag.id
      currentView.value = 'tags'
      return
    }

    activeNoteId.value = null
    selectedContext.value = null
    currentView.value = 'journal'
    if (createJournal) await openDate(selectedDate.value)
  }

  function updateContext(noteId, patch) {
    const note = notes.value.find((item) => item.id === noteId && item.kind === 'context')
    if (!note) return
    const updated = normalizeNote({ ...note, ...patch, markdown: undefined })
    replaceNote(updated)
    persistNote(updated)
  }

  async function ensureTagNote(name) {
    const key = name.toLocaleLowerCase()
    let note = tagNotes.value.find((item) => item.title.toLocaleLowerCase() === key)
    if (!note) {
      note = normalizeNote({
        id: createId(),
        kind: 'tag',
        filename: `${contextSlug(name) || 'etiqueta'}.md`,
        title: name,
        description: '',
        blocks: [{ ...createBlock('heading', name), level: 1 }],
      })
      replaceNote(note)
      await persistNote(note, { immediate: true })
    }
    return note
  }

  async function updateTag(name, patch) {
    const note = await ensureTagNote(name)
    const updated = normalizeNote({
      ...note,
      ...patch,
      description: (patch.description ?? note.description ?? '').slice(0, 50),
      markdown: undefined,
    })
    replaceNote(updated)
    persistNote(updated)
    return updated
  }

  async function removeReferences(name, removeReference, excludedNoteId = null) {
    const affected = notes.value
      .filter((note) => note.id !== excludedNoteId)
      .map((note) => {
        const blocks = note.blocks.map((block) => ({
          ...block,
          content: removeReference(block.content, name),
        }))
        const changed = blocks.some((block, index) => block.content !== note.blocks[index].content)
        return changed ? normalizeNote({ ...note, blocks, markdown: undefined }) : null
      })
      .filter(Boolean)

    const prepared = affected.map((note) => prepareNoteForSave(note, note.version))
    replaceNotes(prepared.map(({ saved }) => saved))
    for (const { saved, expectedVersion } of prepared) {
      await savePreparedNote(saved, expectedVersion)
    }
  }

  async function renameContext(oldName, newName) {
    const sourceName = oldName.trim()
    const targetName = newName.trim()
    if (!sourceName || !targetName || sourceName === targetName) return

    const sourceKey = sourceName.toLocaleLowerCase()
    const targetKey = targetName.toLocaleLowerCase()
    const sourceNote = contextNotes.value.find(
      (note) => note.title.toLocaleLowerCase() === sourceKey,
    )
    const targetNote = contextNotes.value.find(
      (note) => note.title.toLocaleLowerCase() === targetKey,
    )
    const mergeTargetNote = targetNote && targetNote.id !== sourceNote?.id ? targetNote : null
    const excludedNoteId = mergeTargetNote ? sourceNote?.id : null

    if (sourceNote) {
      clearTimeout(saveTimers.get(sourceNote.id))
      saveTimers.delete(sourceNote.id)
    }
    if (mergeTargetNote) {
      clearTimeout(saveTimers.get(mergeTargetNote.id))
      saveTimers.delete(mergeTargetNote.id)
    }

    const affected = notes.value
      .filter((note) => note.id !== excludedNoteId)
      .map((note) => {
        const blocks = note.blocks.map((block) => ({
          ...block,
          content: replaceContextReference(block.content, sourceName, targetName),
        }))
        const changed = blocks.some((block, index) => block.content !== note.blocks[index].content)
        if (!changed) return null
        return normalizeNote({ ...note, blocks, markdown: undefined })
      })
      .filter(Boolean)

    let staleFileNote = null
    if (sourceNote && !mergeTargetNote) {
      const renamedBlocks = sourceNote.blocks.map((block, index) => {
        if (index === 0 && block.type === 'heading' && block.level === 1) {
          return { ...block, content: targetName }
        }
        return block
      })
      const renamedNote = normalizeNote({
        ...sourceNote,
        title: targetName,
        filename: `${contextSlug(targetName) || 'contexto'}.md`,
        blocks: renamedBlocks,
        markdown: undefined,
      })
      staleFileNote = sourceNote
      const existingIndex = affected.findIndex((note) => note.id === renamedNote.id)
      if (existingIndex >= 0) affected.splice(existingIndex, 1, renamedNote)
      else affected.push(renamedNote)
    }

    const prepared = affected.map((note) => prepareNoteForSave(note, note.version))
    replaceNotes(prepared.map(({ saved }) => saved))
    for (const { saved, expectedVersion } of prepared) {
      await savePreparedNote(saved, expectedVersion, {
        removeStaleFile: staleFileNote?.id === saved.id ? staleFileNote : null,
      })
    }

    if (mergeTargetNote && sourceNote) {
      await repository.deleteNote(sourceNote.id)
      if (directoryHandle.value) {
        try {
          await removeNote(directoryHandle.value, sourceNote)
        } catch (error) {
          if (error.name !== 'NotFoundError') throw error
        }
      }
      notes.value = notes.value.filter((note) => note.id !== sourceNote.id)
    }

    const finalNote = mergeTargetNote || sourceNote
    if (selectedContext.value?.toLocaleLowerCase() === sourceKey) {
      selectedContext.value = targetName
      currentView.value = 'context'
      if (finalNote?.id) activeNoteId.value = finalNote.id
    }
  }

  async function deleteContext(name) {
    const key = name.trim().toLocaleLowerCase()
    const contextNote = contextNotes.value.find(
      (note) => note.title.toLocaleLowerCase() === key,
    )

    if (contextNote) {
      clearTimeout(saveTimers.get(contextNote.id))
      saveTimers.delete(contextNote.id)
    }
    await removeReferences(name, removeContextReference, contextNote?.id)

    if (contextNote) {
      await repository.deleteNote(contextNote.id)
      if (directoryHandle.value) {
        try {
          await removeNote(directoryHandle.value, contextNote)
        } catch (error) {
          if (error.name !== 'NotFoundError') throw error
        }
      }
      notes.value = notes.value.filter((note) => note.id !== contextNote.id)
    }

    if (selectedContext.value?.toLocaleLowerCase() === key) {
      selectedContext.value = null
      await openDate(selectedDate.value)
    }
  }

  async function deleteTag(name) {
    const key = name.trim().toLocaleLowerCase()
    const tagNote = tagNotes.value.find((note) => note.title.toLocaleLowerCase() === key)
    await removeReferences(name, removeTagReference)
    if (tagNote) {
      clearTimeout(saveTimers.get(tagNote.id))
      saveTimers.delete(tagNote.id)
      await repository.deleteNote(tagNote.id)
      if (directoryHandle.value) {
        try {
          await removeNote(directoryHandle.value, tagNote)
        } catch (error) {
          if (error.name !== 'NotFoundError') throw error
        }
      }
      notes.value = notes.value.filter((note) => note.id !== tagNote.id)
    }
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
      priority: type === 'task' ? 'base' : undefined,
      level: type === 'heading' ? 2 : undefined,
    })
  }

  function buildTemplateEditorNote(templateId = activeDailyTemplateId.value) {
    const template = dailyTemplates.value.find((item) => item.id === templateId) || null
    return createTemplateEditorNote(template)
  }

  async function saveDailyTemplate(templateId, patch = {}) {
    const existing = dailyTemplates.value.find((template) => template.id === templateId)
    const nextTemplate = {
      ...(existing || { id: templateId || createId(), name: 'Plantilla diaria', blocks: [] }),
      ...patch,
      id: existing?.id || templateId || createId(),
    }
    const preservedTemplates = dailyTemplates.value.filter((template) => template.id !== nextTemplate.id)
    workspaceSettings.value = normalizeWorkspaceSettings({
      dailyTemplates: [...preservedTemplates, nextTemplate],
      activeDailyTemplateId: activeDailyTemplateId.value || nextTemplate.id,
    })
    await persistWorkspaceSettings()
    return workspaceSettings.value.dailyTemplates.find((template) => template.id === nextTemplate.id) || null
  }

  async function saveDailyTemplateFromNote(templateId, note, patch = {}) {
    return saveDailyTemplate(templateId, {
      ...patch,
      blocks: extractTemplateBlocksFromNote(note),
    })
  }

  async function ensurePrimaryDailyTemplate() {
    if (dailyTemplates.value.length) return activeDailyTemplate.value || dailyTemplates.value[0]
    return saveDailyTemplate(createId(), {
      name: 'Plantilla diaria',
      blocks: [],
      isDefault: true,
      order: 0,
    })
  }

  function canApplyDailyTemplateToNote(note) {
    return Boolean(activeDailyTemplate.value && isBaseJournal(note) && activeDailyTemplate.value.blocks.length)
  }

  async function applyDailyTemplate(noteId, templateId = activeDailyTemplateId.value) {
    const note = notes.value.find((item) => item.id === noteId)
    if (!note || !isBaseJournal(note)) return false
    const template = dailyTemplates.value.find((item) => item.id === templateId)
      || resolveActiveDailyTemplate(workspaceSettings.value)
    if (!template || !template.blocks.length) return false

    const updated = normalizeNote({
      ...note,
      blocks: [note.blocks[0], ...cloneTemplateBlocks(template.blocks)],
      markdown: undefined,
    })
    replaceNote(updated)
    await persistNote(updated, { immediate: true })
    return true
  }

  async function importFiles(files) {
    const imports = []
    let importedManifest = null
    for (const file of files) {
      if (file.name.toLowerCase().endsWith('.zip')) {
        const archive = await JSZip.loadAsync(file)
        const manifestEntry = archive.file('second-mind.json')
        if (manifestEntry) importedManifest = JSON.parse(await manifestEntry.async('string'))
        const entries = Object.values(archive.files).filter(
          (entry) => !entry.dir && entry.name.toLowerCase().endsWith('.md'),
        )
        for (const entry of entries) {
          const filename = entry.name.split('/').pop()
          const markdown = await entry.async('string')
          imports.push(createImportedNote(filename, markdown, Date.now(), entry.name))
        }
        continue
      }
      if (!file.name.toLowerCase().endsWith('.md')) continue
      imports.push(
        createImportedNote(file.name, await file.text(), file.lastModified, file.webkitRelativePath),
      )
    }
    await importNotes(imports, importedManifest)
  }

  async function importDirectory() {
    if (!window.showDirectoryPicker) throw new Error('Este navegador no permite importar carpetas.')
    const handle = await window.showDirectoryPicker({ mode: 'read' })
    if (!(await verifyPermission(handle))) return
    const markdownFiles = await readMarkdownTree(handle)
    const imports = markdownFiles.map((file) =>
      createImportedNote(file.filename, file.markdown, file.updatedAt, file.path),
    )
    await importNotes(imports, markdownFiles.workspaceManifest)
  }

  async function importNotes(imports, manifest = null) {
    if (!imports.length) {
      if (manifest) await applyWorkspaceManifest(manifest)
      return
    }

    const existingByIdentity = new Map(notes.value.map((note) => [importIdentity(note), note]))
    const importsByIdentity = new Map()
    for (const note of imports) {
      const existing = existingByIdentity.get(importIdentity(note))
      importsByIdentity.set(importIdentity(note), existing ? { ...note, id: existing.id } : note)
    }

    const importedNotes = [...importsByIdentity.values()]
    const importedIds = new Set(importedNotes.map((note) => note.id))
    const importedIdentities = new Set(importedNotes.map(importIdentity))
    notes.value = [
      ...notes.value.filter(
        (note) => !importedIds.has(note.id) && !importedIdentities.has(importIdentity(note)),
      ),
      ...importedNotes,
    ]
    await repository.saveNotes(importedNotes)
    if (manifest) await applyWorkspaceManifest(manifest)
    if (directoryHandle.value) {
      for (const note of importedNotes) await writeNote(directoryHandle.value, note)
      await writeWorkspaceManifest(directoryHandle.value, createWorkspaceManifest())
    } else {
      hasPendingLocalImport = true
    }
    await activateFirstAvailableNote({ createJournal: false })
  }

  function createImportedNote(filename, markdown, lastModified, sourcePath = filename) {
    const date = sourcePath.match(/\d{4}-\d{2}-\d{2}/)?.[0] || null
    return normalizeNote({
      id: undefined,
      kind: date ? 'journal' : undefined,
      filename,
      date,
      markdown,
      updatedAt: new Date(lastModified || Date.now()).toISOString(),
    })
  }

  async function connectWorkspace() {
    if (!window.showDirectoryPicker) throw new Error('Este navegador no permite abrir carpetas.')
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' })
    directoryHandle.value = handle
    workspaceName.value = handle.name
    workspacePersistence.value = (await saveDirectoryHandle(handle)) ? 'persisted' : 'session'
    const diskNotes = await readWorkspace(handle)
    if (diskNotes.length && !hasPendingLocalImport) {
      await applyWorkspaceNotes(diskNotes, {
        reason: 'connect-existing-workspace',
      })
      await applyWorkspaceManifest(diskNotes.workspaceManifest)
    } else {
      const notesToWrite = hasPendingLocalImport
        ? mergeImportedNotesWithDisk(diskNotes)
        : notes.value.map((note) => normalizeNote(note))
      notes.value = notesToWrite
      for (const note of notesToWrite) await writeNote(handle, note)
      await repository.replaceAllNotes(notesToWrite)
      if (diskNotes.workspaceManifest?.settings) {
        await applyWorkspaceManifest(diskNotes.workspaceManifest)
      } else {
        await writeWorkspaceManifest(handle, createWorkspaceManifest())
      }
    }
    hasPendingLocalImport = false
    await activateFirstAvailableNote({ createJournal: false })
    syncState.value = settledSyncState()
  }

  function mergeImportedNotesWithDisk(diskNotes) {
    const merged = new Map()
    for (const diskNote of diskNotes) {
      const note = normalizeImportedNote(diskNote)
      merged.set(importIdentity(note), note)
    }
    for (const note of notes.value.map((item) => normalizeNote(item))) {
      merged.set(importIdentity(note), note)
    }
    return [...merged.values()]
  }

  async function restoreWorkspace() {
    try {
      const handle = await getDirectoryHandle()
      if (handle && (await verifyPermission(handle, true))) {
        directoryHandle.value = handle
        workspaceName.value = handle.name
        workspacePersistence.value = 'persisted'
        const manifest = await readWorkspaceManifest(handle)
        await applyWorkspaceManifest(manifest)
        return true
      }
    } catch {
      workspacePersistence.value = 'none'
      syncState.value = 'Modo local sin carpeta'
    }
    return false
  }

  async function reloadWorkspaceFromDisk() {
    if (!directoryHandle.value) throw new Error('No hay ninguna carpeta conectada.')
    await loadWorkspaceFromDisk()
    await activateFirstAvailableNote({ createJournal: false })
  }

  async function restoreRecoverySnapshot(snapshotId) {
    const snapshot = recoverySnapshots.value.find((item) => item.id === snapshotId)
    if (!snapshot) throw new Error('No se encontró la copia de seguridad seleccionada.')
    await persistRecoverySnapshot('before-restore-snapshot')
    const currentNotes = notes.value.map((note) => normalizeNote(note))
    const restoredNotes = (snapshot.notes || []).map((note) => normalizeNote(note))
    const restoredIdentities = new Set(restoredNotes.map(importIdentity))
    notes.value = restoredNotes
    workspaceSettings.value = normalizeWorkspaceSettings(snapshot.settings || {})
    localStorage.setItem(THEME_PREFERENCE_KEY, workspaceSettings.value.theme)
    await repository.replaceAllNotes(restoredNotes)
    await repository.setSetting(WORKSPACE_SETTINGS_KEY, cloneForStorage(workspaceSettings.value))
    if (directoryHandle.value) {
      for (const note of currentNotes.filter((item) => !restoredIdentities.has(importIdentity(item)))) {
        try {
          await removeNote(directoryHandle.value, note)
        } catch (error) {
          if (error.name !== 'NotFoundError') throw error
        }
      }
      for (const note of restoredNotes) await writeNote(directoryHandle.value, note)
      await writeWorkspaceManifest(directoryHandle.value, createWorkspaceManifest())
    }
    await activateFirstAvailableNote({ createJournal: false })
    syncState.value = settledSyncState()
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

  function getTag(name) {
    return tags.value.find((tag) => tag.name.toLocaleLowerCase() === name.toLocaleLowerCase())
  }

  function contextBlocks(name) {
    return sortContextBlocksByDate(projectContextBlocks(allBlocks.value, name))
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
    syncState.value = settledSyncState()
    checkDueNotifications()
  })
  window.addEventListener('offline', () => {
    syncState.value = settledSyncState()
  })

  return {
    repository,
    notes,
    workspaceSettings,
    dailyTemplates,
    activeDailyTemplateId,
    activeDailyTemplate,
    theme,
    journals,
    activeNote,
    activeNoteId,
    currentView,
    selectedDate,
    selectedContext,
    loading,
    syncState,
    workspaceName,
    workspacePersistenceLabel,
    recoverySnapshots,
    conflicts,
    allBlocks,
    tasks,
    reminders,
    contextIndex,
    tags,
    tagNotes,
    initialize,
    openDate,
    setView,
    openContext,
    updateContext,
    renameContext,
    updateTag,
    deleteContext,
    deleteTag,
    updateBlock,
    addBlock,
    removeBlock,
    changeBlockType,
    buildTemplateEditorNote,
    ensurePrimaryDailyTemplate,
    saveDailyTemplate,
    saveDailyTemplateFromNote,
    canApplyDailyTemplateToNote,
    applyDailyTemplate,
    setTheme,
    toggleTheme,
    createWorkspaceManifest,
    importFiles,
    importDirectory,
    connectWorkspace,
    reloadWorkspaceFromDisk,
    restoreRecoverySnapshot,
    requestNotificationPermission,
    checkDueNotifications,
    openBlock,
    getContext,
    getTag,
    contextBlocks,
    search,
  }
}
