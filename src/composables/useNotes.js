import { computed, ref, watch } from 'vue'
import {
  contextSlug,
  contextTemplate,
  dailyTemplate,
  excerpt,
  extractContexts,
  titleFromMarkdown,
} from '../lib/markdown'
import {
  getDirectoryHandle,
  readWorkspace,
  saveDirectoryHandle,
  verifyPermission,
  writeNote,
} from '../lib/storage'

const LOCAL_KEY = 'second-mind-notes-v1'

function isoDate(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 10)
}

const starterNotes = [
  {
    id: 'journals/welcome.md',
    kind: 'journal',
    filename: `${isoDate()}.md`,
    markdown: `---
date: ${isoDate()}
type: journal
---

# ${isoDate()}

- Bienvenido a tu segundo cerebro.
- Escribe una idea y relaciónala con un [[Contexto]].
- Las etiquetas como #trabajo también aparecen como contextos.

## Próximos pasos

- Abre una carpeta para guardar estas notas como Markdown real.
- Importa tus exportaciones de Reflect arrastrando archivos .md.
`,
    updatedAt: Date.now(),
  },
  {
    id: 'contexts/contexto.md',
    kind: 'context',
    filename: 'contexto.md',
    markdown: `${contextTemplate('Contexto')}Una página para reunir notas relacionadas, sin importar el día en que fueron escritas.`,
    updatedAt: Date.now(),
  },
]

function normalizeNote(note) {
  const dateMatch = note.filename.match(/\d{4}-\d{2}-\d{2}/)
  return {
    ...note,
    date: dateMatch?.[0] || null,
    title: titleFromMarkdown(note.markdown, note.filename.replace(/\.md$/i, '')),
    contexts: extractContexts(note.markdown),
    excerpt: excerpt(note.markdown),
  }
}

export function useNotes() {
  const saved = localStorage.getItem(LOCAL_KEY)
  const notes = ref((saved ? JSON.parse(saved) : starterNotes).map(normalizeNote))
  const activeId = ref(notes.value[0]?.id)
  const directoryHandle = ref(null)
  const workspaceName = ref('Modo local')
  const syncState = ref('Guardado')
  let saveTimer

  const activeNote = computed(() => notes.value.find((note) => note.id === activeId.value))
  const journals = computed(() =>
    notes.value
      .filter((note) => note.kind === 'journal')
      .sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.updatedAt - a.updatedAt),
  )
  const contextNotes = computed(() => notes.value.filter((note) => note.kind === 'context'))
  const contextIndex = computed(() => {
    const index = new Map()
    for (const note of notes.value) {
      for (const context of note.contexts) {
        const key = context.toLocaleLowerCase()
        const entry = index.get(key) || { name: context, count: 0, notes: [] }
        entry.count += 1
        entry.notes.push(note.id)
        index.set(key, entry)
      }
    }
    for (const note of contextNotes.value) {
      const name = note.title
      const key = name.toLocaleLowerCase()
      const entry = index.get(key) || { name, count: 0, notes: [] }
      entry.pageId = note.id
      index.set(key, entry)
    }
    return [...index.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  })

  watch(
    notes,
    (value) => {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(value))
    },
    { deep: true },
  )

  async function connectWorkspace() {
    if (!window.showDirectoryPicker) throw new Error('Tu navegador no permite abrir carpetas directamente.')
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' })
    await saveDirectoryHandle(handle)
    await loadDirectory(handle)
  }

  async function restoreWorkspace() {
    try {
      const handle = await getDirectoryHandle()
      if (handle && (await verifyPermission(handle, true))) await loadDirectory(handle)
    } catch {
      // The local cache remains available when directory permission is unavailable.
    }
  }

  async function loadDirectory(handle) {
    syncState.value = 'Leyendo…'
    const diskNotes = await readWorkspace(handle)
    directoryHandle.value = handle
    workspaceName.value = handle.name
    if (diskNotes.length) {
      notes.value = diskNotes.map(normalizeNote)
      activeId.value = journals.value[0]?.id || notes.value[0]?.id
    }
    syncState.value = 'Sincronizado'
  }

  async function persist(note) {
    syncState.value = 'Guardando…'
    if (directoryHandle.value) await writeNote(directoryHandle.value, note)
    syncState.value = directoryHandle.value ? 'Sincronizado' : 'Guardado local'
  }

  function updateActive(markdown) {
    const index = notes.value.findIndex((note) => note.id === activeId.value)
    if (index < 0) return
    notes.value[index] = normalizeNote({
      ...notes.value[index],
      markdown,
      updatedAt: Date.now(),
    })
    syncState.value = 'Editando…'
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => persist(notes.value[index]), 500)
  }

  async function openToday() {
    const date = isoDate()
    const existing = notes.value.find((note) => note.kind === 'journal' && note.date === date)
    if (existing) {
      activeId.value = existing.id
      return
    }
    const note = normalizeNote({
      id: `journals/${date}.md`,
      kind: 'journal',
      filename: `${date}.md`,
      markdown: dailyTemplate(date),
      updatedAt: Date.now(),
    })
    notes.value.push(note)
    activeId.value = note.id
    await persist(note)
  }

  async function openContext(name) {
    const key = name.toLocaleLowerCase()
    const existing = contextNotes.value.find((note) => note.title.toLocaleLowerCase() === key)
    if (existing) {
      activeId.value = existing.id
      return
    }
    const filename = `${contextSlug(name) || 'contexto'}.md`
    const note = normalizeNote({
      id: `contexts/${filename}`,
      kind: 'context',
      filename,
      markdown: contextTemplate(name),
      updatedAt: Date.now(),
    })
    notes.value.push(note)
    activeId.value = note.id
    await persist(note)
  }

  async function importFiles(files) {
    for (const file of files) {
      if (!file.name.toLowerCase().endsWith('.md')) continue
      const markdown = await file.text()
      const dateMatch = file.name.match(/\d{4}-\d{2}-\d{2}/)
      const kind = dateMatch ? 'journal' : 'context'
      const note = normalizeNote({
        id: `${kind === 'context' ? 'contexts' : 'journals'}/${file.name}`,
        kind,
        filename: file.name,
        markdown,
        updatedAt: file.lastModified || Date.now(),
      })
      const index = notes.value.findIndex((item) => item.id === note.id)
      if (index >= 0) notes.value[index] = note
      else notes.value.push(note)
      await persist(note)
    }
    activeId.value = journals.value[0]?.id || notes.value[0]?.id
  }

  function downloadActive() {
    if (!activeNote.value) return
    const blob = new Blob([activeNote.value.markdown], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = activeNote.value.filename
    link.click()
    URL.revokeObjectURL(url)
  }

  return {
    notes,
    journals,
    activeId,
    activeNote,
    contextIndex,
    workspaceName,
    syncState,
    connectWorkspace,
    restoreWorkspace,
    updateActive,
    openToday,
    openContext,
    importFiles,
    downloadActive,
  }
}
