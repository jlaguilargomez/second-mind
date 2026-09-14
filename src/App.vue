<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import JSZip from 'jszip'
import { registerSW } from 'virtual:pwa-register'
import BlockEditor from './components/BlockEditor.vue'
import CalendarPanel from './components/CalendarPanel.vue'
import ReminderDialog from './components/ReminderDialog.vue'
import RichText from './components/RichText.vue'
import {
  createBlock,
  formatReminderDate,
  DEFAULT_CONTEXT_TYPE,
  isoDate,
  normalizeNote,
  reminderDate,
  serializeContextShare,
  serializeJournalShare,
  serializeNote,
  projectTagBlocks,
  sortContextBlocksByDate,
} from './lib/markdown'
import { isTrackingTask } from './lib/taskClassification'
import { ASSISTANT_PERIODS, buildAssistantContext } from './lib/assistantContext'
import { OllamaProvider } from './ai/OllamaProvider'
import { ViteOllamaProvider } from './ai/ViteOllamaProvider'
import { contextTypes, useSecondMind } from './composables/useSecondMind'

const mind = useSecondMind()
const {
  notes,
  journals,
  independentNotes,
  activeNoteId,
  activeNote,
  currentView,
  selectedDate,
  selectedContext,
  loading,
  syncState,
  workspaceName,
  workspacePersistenceLabel,
  canRestoreRecoverySnapshots,
  recoverySnapshots,
  theme,
  dailyTemplates,
  activeDailyTemplate,
  conflicts,
  allBlocks,
  tasks,
  reminders,
  contextIndex,
  tags,
} = mind

const searchQuery = ref('')
const showSearch = ref(false)
const showContextDialog = ref(false)
const showNoteDialog = ref(false)
const showTemplateDialog = ref(false)
const showRecoveryDialog = ref(false)
const showMobilePanel = ref(false)
const showMobileMore = ref(false)
const newContextName = ref('')
const newContextType = ref(DEFAULT_CONTEXT_TYPE)
const newNoteTitle = ref('')
const selectedTag = ref(null)
const taskFilter = ref('open')
const contextFilter = ref('all')
const priorityFilter = ref('all')
const priorityRank = { high: 0, medium: 1, base: 2 }
const reminderBlock = ref(null)
const importInput = ref(null)
const connectionError = ref('')
const importError = ref('')
const recoveryError = ref('')
const copyState = ref('idle')
const isOnline = ref(navigator.onLine)
const updateAvailable = ref(false)
const tagDescriptionDraft = ref('')
const templateDraftNote = ref(null)
const templateNameDraft = ref('')
const contextRenameDraft = ref('')
const assistantPeriod = ref(14)
const assistantQuestion = ref('')
const assistantMessages = ref([])
const assistantStatus = ref('idle')
const assistantError = ref('')
const assistantContext = ref(null)
const assistantBaseUrlDraft = ref('')
const assistantModelDraft = ref('')
const assistantController = ref(null)
const assistantElapsedSeconds = ref(0)
const noteTitleDraft = ref('')
const updateSW = registerSW({
  onNeedRefresh() {
    updateAvailable.value = true
  },
})
let notificationTimer
let copyStateTimer
let assistantElapsedTimer

const pageTitle = computed(() => {
  if (currentView.value === 'journal') {
    return new Date(`${selectedDate.value}T12:00:00`).toLocaleDateString(undefined, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
  }
  if (currentView.value === 'notes') return activeNote.value?.title || 'Notas'
  if (currentView.value === 'context') return `@${selectedContext.value}`
  if (currentView.value === 'tasks') return 'Tareas'
  if (currentView.value === 'agenda') return 'Agenda'
  if (currentView.value === 'tracking') return 'Seguimiento'
  if (currentView.value === 'assistant') return 'Asistente'
  if (currentView.value === 'contexts') return 'Contextos'
  if (currentView.value === 'tags' && selectedTag.value) return `#${selectedTag.value}`
  if (currentView.value === 'tags') return 'Etiquetas / Proyectos'
  return 'Second Mind'
})
const breadcrumbParent = computed(() => {
  if (currentView.value === 'journal') return { label: 'Diario', target: 'journal' }
  if (currentView.value === 'notes' && activeNote.value?.kind === 'note') {
    return { label: 'Notas', target: 'notes' }
  }
  if (currentView.value === 'context' && selectedContext.value) {
    return { label: 'Contextos', target: 'contexts' }
  }
  if (currentView.value === 'tags' && selectedTag.value) {
    return { label: 'Etiquetas', target: 'tags' }
  }
  return null
})
const compactJournalTitle = computed(() =>
  new Date(`${selectedDate.value}T12:00:00`).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
  }),
)

const filteredTasks = computed(() =>
  tasks.value.filter((task) => {
    if (isTrackingTask(task)) return false
    if (taskFilter.value === 'open' && task.checked) return false
    if (taskFilter.value === 'completed' && !task.checked) return false
    if (
      taskFilter.value === 'today' &&
      reminderDate(task.reminder) !== isoDate()
    ) {
      return false
    }
    if (
      contextFilter.value !== 'all' &&
      !task.contexts.some(
        (context) => context.toLocaleLowerCase() === contextFilter.value.toLocaleLowerCase(),
      )
    ) {
      return false
    }
    if (
      priorityFilter.value !== 'all' &&
      (task.priority || 'base') !== priorityFilter.value
    ) {
      return false
    }
    if (selectedTag.value && !task.tags.includes(selectedTag.value)) return false
    return true
  }).sort(
    (a, b) =>
      priorityRank[a.priority || 'base'] - priorityRank[b.priority || 'base'] ||
      (a.reminder || '9999-12-31').localeCompare(b.reminder || '9999-12-31'),
  ),
)

const hasTaskFilters = computed(() =>
  taskFilter.value !== 'open' ||
  contextFilter.value !== 'all' ||
  priorityFilter.value !== 'all' ||
  Boolean(selectedTag.value),
)

function clearTaskFilters() {
  taskFilter.value = 'open'
  contextFilter.value = 'all'
  priorityFilter.value = 'all'
  selectedTag.value = null
}

function priorityLabel(priority) {
  return { medium: 'Media', high: 'Alta' }[priority] || ''
}

const reminderGroups = computed(() => ({
  overdue: reminders.value.filter((block) => block.reminderState === 'overdue'),
  today: reminders.value.filter((block) => block.reminderState === 'today'),
  upcoming: reminders.value.filter((block) => block.reminderState === 'upcoming'),
}))

const activeContext = computed(() =>
  selectedContext.value ? mind.getContext(selectedContext.value) : null,
)
const activeContextBlocks = computed(() =>
  selectedContext.value ? mind.contextBlocks(selectedContext.value) : [],
)
const contextTasks = computed(() =>
  activeContextBlocks.value.filter((block) => block.type === 'task' && !block.checked),
)
const contextTags = computed(() => {
  const counts = new Map()
  for (const block of activeContextBlocks.value) {
    for (const tag of block.tags) counts.set(tag, (counts.get(tag) || 0) + 1)
  }
  return [...counts.entries()].map(([name, count]) => ({ name, count }))
})
const tagProjects = computed(() =>
  tags.value
    .map((tag) => {
      const projectBlocks = projectTagBlocks(allBlocks.value, tag.name)
      const projectTasks = projectBlocks.filter((block) => block.type === 'task' && block.tagMatch)
      const completedTasks = projectTasks.filter((task) => task.checked).length
      const openTasks = projectTasks.filter((task) => !task.checked)
      const upcomingTasks = openTasks
        .filter((task) => task.reminder)
        .sort((a, b) => (a.reminder || '').localeCompare(b.reminder || ''))
        .slice(0, 3)
      const recentBlocks = sortContextBlocksByDate(projectBlocks)
        .filter((block) => block.type !== 'task' && block.content?.trim())
        .slice(0, 3)

      return {
        ...tag,
        blocks: projectBlocks,
        openTasks,
        totalTasks: projectTasks.length,
        completedTasks,
        progressPercent: projectTasks.length
          ? Math.round((completedTasks / projectTasks.length) * 100)
          : 0,
        upcomingTasks,
        recentBlocks,
      }
    })
    .sort((a, b) => b.openTasks.length - a.openTasks.length || b.count - a.count),
)
const activeTagProject = computed(() =>
  selectedTag.value
    ? tagProjects.value.find((tag) => tag.name.toLocaleLowerCase() === selectedTag.value.toLocaleLowerCase())
    : null,
)
const activeTagOpenTasks = computed(() =>
  activeTagProject.value?.blocks.filter((block) => block.type === 'task' && block.tagMatch && !block.checked) || [],
)
const activeTagCompletedTasks = computed(() =>
  activeTagProject.value?.blocks.filter((block) => block.type === 'task' && block.tagMatch && block.checked) || [],
)
const activeTagRecentBlocks = computed(() =>
  activeTagProject.value
    ? sortContextBlocksByDate(activeTagProject.value.blocks)
      .filter((block) => block.type !== 'task' && block.content?.trim())
      .slice(0, 8)
    : [],
)
const supportContexts = computed(() =>
  contextIndex.value.filter((context) =>
    ['team', 'area'].includes(context.contextType || DEFAULT_CONTEXT_TYPE),
  ),
)
const contextTypeOrder = ['project', 'area', 'team', 'person']
const groupedContexts = computed(() =>
  contextTypeOrder
    .map((type) => ({
      type,
      label: contextTypes[type],
      contexts: contextIndex.value.filter(
        (context) => (context.contextType || DEFAULT_CONTEXT_TYPE) === type,
      ),
    }))
    .filter((group) => group.contexts.length),
)
const peopleContexts = computed(() =>
  contextIndex.value.filter((context) => context.contextType === 'person'),
)
const waitingTasks = computed(() =>
  tasks.value.filter((task) => !task.checked && isTrackingTask(task)),
)
const searchResults = computed(() => mind.search(searchQuery.value))
const searchContextResults = computed(() => {
  const rawQuery = searchQuery.value.trim()
  if (!rawQuery || rawQuery.startsWith('#')) return []
  const query = rawQuery.replace(/^@/, '').toLocaleLowerCase()
  return contextIndex.value
    .filter((context) => context.name.toLocaleLowerCase().includes(query))
    .slice(0, 5)
})
const journalEntryCount = computed(() =>
  activeNote.value?.blocks.filter(
    (block) =>
      !(block.type === 'heading' && block.level === 1) &&
      block.content.trim(),
  ).length || 0,
)
const journalContextCount = computed(() => activeNote.value?.contexts.length || 0)
const canApplyDailyTemplate = computed(() => mind.canApplyDailyTemplateToNote(activeNote.value))
const currentDailyTemplateName = computed(() => activeDailyTemplate.value?.name || 'Plantilla diaria')
const themeToggleLabel = computed(() =>
  theme.value === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro',
)
const mobileMoreActive = computed(() =>
  ['assistant', 'context', 'contexts', 'tags', 'tracking'].includes(currentView.value),
)
const assistantSettings = computed(() => mind.workspaceSettings.value.assistant)
const assistantSuggestions = [
  '¿Qué debería hacer hoy y por qué?',
  '¿Qué tareas tengo esperando o delegadas?',
  '¿Qué tareas parecen estancadas?',
  'Agrupa mis próximas acciones por contexto.',
]
const assistantContextSummary = computed(() => {
  const counts = assistantContext.value?.counts
  if (!counts) return ''
  return `${counts.included} fuentes · ${counts.openTasks} tareas abiertas · ${counts.tracking} seguimientos`
})

watch(
  theme,
  (value) => {
    document.documentElement.dataset.theme = value
  },
  { immediate: true },
)

watch(
  activeTagProject,
  (tag) => {
    tagDescriptionDraft.value = tag?.description || ''
  },
  { immediate: true },
)

watch(
  activeContext,
  (context) => {
    contextRenameDraft.value = context?.name || ''
  },
  { immediate: true },
)

watch(
  assistantSettings,
  (settings) => {
    assistantBaseUrlDraft.value = settings.baseUrl
    assistantModelDraft.value = settings.model
  },
  { immediate: true },
)

watch(
  activeNote,
  (note) => {
    if (note?.kind === 'note') noteTitleDraft.value = note.title
  },
  { immediate: true },
)

function pluralize(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`
}

const canCopySection = computed(() =>
  ['journal', 'context'].includes(currentView.value) &&
  (currentView.value !== 'journal' || activeNote.value) &&
  (currentView.value !== 'context' || selectedContext.value),
)

async function writeClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  const copied = document.execCommand('copy')
  textarea.remove()
  if (!copied) throw new Error('No se pudo copiar el contenido.')
}

async function copyCurrentSection() {
  const markdown = currentView.value === 'journal'
    ? serializeJournalShare(pageTitle.value, activeNote.value?.blocks || [])
    : serializeContextShare(selectedContext.value, activeContextBlocks.value)

  try {
    await writeClipboard(`${markdown}\n`)
    copyState.value = 'copied'
  } catch {
    copyState.value = 'error'
  }

  window.clearTimeout(copyStateTimer)
  copyStateTimer = window.setTimeout(() => {
    copyState.value = 'idle'
  }, 2200)
}

function navigate(view) {
  if (view === 'notes') {
    openNotes()
    return
  }
  mind.setView(view)
  showMobilePanel.value = false
  showMobileMore.value = false
  if (view === 'assistant' && assistantStatus.value === 'idle') void checkAssistant()
}

function openNotes() {
  activeNoteId.value = null
  mind.setView('notes')
  showMobilePanel.value = false
  showMobileMore.value = false
}

function openBreadcrumbParent() {
  if (breadcrumbParent.value?.target === 'journal') {
    openDate(isoDate())
    return
  }
  if (breadcrumbParent.value?.target === 'notes') {
    openNotes()
    return
  }
  if (breadcrumbParent.value?.target === 'contexts') {
    navigate('contexts')
    return
  }
  if (breadcrumbParent.value?.target === 'tags') openTagsIndex()
}

function createAssistantProvider() {
  if (import.meta.env.DEV && import.meta.hot) {
    return new ViteOllamaProvider({ model: assistantSettings.value.model })
  }
  const configuredUrl = assistantSettings.value.baseUrl
  const isLocalDevelopment = ['localhost', '127.0.0.1'].includes(window.location.hostname)
  return new OllamaProvider({
    ...assistantSettings.value,
    // Vite reenvía esta ruta al servicio Ollama del equipo. Forzarla en
    // desarrollo evita que navegadores aislados bloqueen el puerto 11434.
    baseUrl: isLocalDevelopment ? '/assistant-api' : configuredUrl,
  })
}

function assistantErrorMessage(error) {
  if (error?.name === 'AbortError') return ''
  if (error?.name === 'TimeoutError') return 'Ollama ha tardado demasiado en responder.'
  if (error instanceof TypeError) {
    return 'No se puede conectar con Ollama. Comprueba que está iniciado y permite el origen de esta aplicación.'
  }
  return error?.message || 'No se pudo conectar con Ollama.'
}

async function checkAssistant() {
  assistantStatus.value = 'checking'
  assistantError.value = ''
  try {
    const result = await createAssistantProvider().checkAvailability()
    assistantStatus.value = result.available ? 'ready' : 'model-missing'
    if (!result.available) {
      assistantError.value = `Ollama está activo, pero falta el modelo ${result.model}.`
    }
  } catch (error) {
    assistantStatus.value = 'error'
    assistantError.value = assistantErrorMessage(error)
  }
}

async function saveAssistantConfiguration() {
  await mind.setAssistantSettings({
    baseUrl: assistantBaseUrlDraft.value,
    model: assistantModelDraft.value,
  })
  await checkAssistant()
}

async function askAssistant(suggestedQuestion = '') {
  const question = String(suggestedQuestion || assistantQuestion.value).trim()
  if (!question || assistantStatus.value === 'thinking') return
  if (assistantStatus.value !== 'ready') {
    await checkAssistant()
    if (assistantStatus.value !== 'ready') return
  }

  const context = buildAssistantContext(notes.value.filter((note) => note.kind !== 'note'), {
    periodDays: assistantPeriod.value,
    today: isoDate(),
  })
  assistantContext.value = context
  assistantMessages.value.push({ role: 'user', content: question })
  assistantQuestion.value = ''
  assistantStatus.value = 'thinking'
  startAssistantTimer()
  assistantError.value = ''
  const controller = new AbortController()
  assistantController.value = controller
  try {
    const conversation = assistantMessages.value.slice(0, -1).map((message) => ({
      role: message.role,
      content: message.content,
    }))
    const answer = await createAssistantProvider().generateAnswer({
      question,
      context,
      conversation,
      signal: controller.signal,
    })
    assistantMessages.value.push({
      role: 'assistant',
      content: answer.text,
      references: answer.references,
      insufficientEvidence: answer.insufficientEvidence,
    })
    assistantStatus.value = 'ready'
  } catch (error) {
    if (error?.name === 'AbortError') assistantStatus.value = 'ready'
    else {
      assistantStatus.value = 'ready'
      assistantError.value = assistantErrorMessage(error)
    }
  } finally {
    stopAssistantTimer()
    if (assistantController.value === controller) assistantController.value = null
  }
}

function cancelAssistant() {
  assistantController.value?.abort(new DOMException('Cancelado', 'AbortError'))
}

function startAssistantTimer() {
  window.clearInterval(assistantElapsedTimer)
  const startedAt = Date.now()
  assistantElapsedSeconds.value = 0
  assistantElapsedTimer = window.setInterval(() => {
    assistantElapsedSeconds.value = Math.floor((Date.now() - startedAt) / 1000)
  }, 1000)
}

function stopAssistantTimer() {
  window.clearInterval(assistantElapsedTimer)
  assistantElapsedTimer = undefined
}

function clearAssistantConversation() {
  assistantMessages.value = []
  assistantContext.value = null
  assistantError.value = ''
}

async function openAssistantReference(reference) {
  const note = notes.value.find((item) => item.id === reference.noteId)
  if (!note) return
  if (note.kind === 'journal' && note.date) {
    mind.openBlock({ noteId: note.id, noteDate: note.date })
  } else if (note.kind === 'context') {
    await mind.openContext(note.title)
  }
  await nextTick()
  {
    document.querySelector(`[data-block-id="${reference.blockId}"]`)?.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    })
  }
}

function openContext(name) {
  selectedTag.value = null
  mind.openContext(name)
  showMobilePanel.value = false
  showMobileMore.value = false
}

function openTag(name) {
  selectedTag.value = name
  navigate('tags')
}

function openTagsIndex() {
  selectedTag.value = null
  navigate('tags')
}

function viewTagTasks(name) {
  selectedTag.value = name
  taskFilter.value = 'all'
  navigate('tasks')
}

function openTask(block) {
  mind.openBlock(block)
  nextTick(() => {
    document.querySelector(`[data-block-id="${block.id}"]`)?.scrollIntoView({ behavior: 'smooth' })
  })
}

function openSearch() {
  showSearch.value = true
  showMobilePanel.value = false
  showMobileMore.value = false
  nextTick(() => document.querySelector('.search-input')?.focus())
}

function openSearchContext(name) {
  openContext(name)
  showSearch.value = false
}

function openFirstSearchResult() {
  const context = searchContextResults.value[0]
  if (context) {
    openSearchContext(context.name)
    return
  }
  const block = searchResults.value[0]
  if (block) {
    openTask(block)
    showSearch.value = false
  }
}

function openDate(date) {
  mind.openDate(date)
  showMobilePanel.value = false
  showMobileMore.value = false
}

function toggleMobileMore() {
  showMobilePanel.value = false
  showMobileMore.value = !showMobileMore.value
}

async function createIndependentNote() {
  newNoteTitle.value = ''
  showNoteDialog.value = true
  showMobilePanel.value = false
  await nextTick()
  document.querySelector('.new-note-title')?.focus()
}

async function confirmCreateIndependentNote() {
  const title = newNoteTitle.value.trim()
  if (!title) return
  await mind.createNote(title)
  showNoteDialog.value = false
  newNoteTitle.value = ''
}

async function saveIndependentNoteTitle() {
  if (activeNote.value?.kind !== 'note') return
  const saved = await mind.renameNote(activeNote.value.id, noteTitleDraft.value)
  if (saved) noteTitleDraft.value = saved.title
}

async function deleteIndependentNote() {
  if (!activeNote.value || activeNote.value.kind !== 'note' || activeNote.value.locked) return
  if (!window.confirm(`¿Eliminar la nota «${activeNote.value.title}»? Esta acción no se puede deshacer.`)) return
  await mind.deleteNote(activeNote.value.id)
}

async function toggleActiveNoteLock() {
  const note = activeNote.value
  if (!note || !['journal', 'note'].includes(note.kind)) return

  const nextLocked = !note.locked
  if (!nextLocked) {
    const label = note.kind === 'journal' ? 'este día' : `la nota «${note.title}»`
    if (!window.confirm(`¿Desbloquear ${label}? Podrás volver a modificar su contenido.`)) return
  }

  await mind.setNoteLocked(note.id, nextLocked)
}

function resetTemplateDraft() {
  templateDraftNote.value = null
  templateNameDraft.value = ''
}

async function openTemplateDialog() {
  const template = await mind.ensurePrimaryDailyTemplate()
  templateDraftNote.value = mind.buildTemplateEditorNote(template.id)
  templateNameDraft.value = template.name
  showTemplateDialog.value = true
  showMobilePanel.value = false
}

function closeTemplateDialog() {
  showTemplateDialog.value = false
  resetTemplateDraft()
}

function updateTemplateDraft(blockId, patch) {
  if (!templateDraftNote.value) return
  const blocks = templateDraftNote.value.blocks.map((block) =>
    block.id === blockId
      ? { ...block, ...patch, updatedAt: new Date().toISOString() }
      : block,
  )
  templateDraftNote.value = normalizeNote({ ...templateDraftNote.value, blocks, markdown: undefined })
}

function addTemplateDraftBlock(afterBlockId, type, content = '', options = {}) {
  if (!templateDraftNote.value) return null
  const blocks = [...templateDraftNote.value.blocks]
  const index = blocks.findIndex((block) => block.id === afterBlockId)
  blocks.splice(index < 0 ? blocks.length : index + 1, 0, { ...createBlock(type, content), ...options })
  templateDraftNote.value = normalizeNote({ ...templateDraftNote.value, blocks, markdown: undefined })
  return null
}

function removeTemplateDraftBlock(blockId) {
  if (!templateDraftNote.value || templateDraftNote.value.blocks.length <= 1) return
  templateDraftNote.value = normalizeNote({
    ...templateDraftNote.value,
    blocks: templateDraftNote.value.blocks.filter((block) => block.id !== blockId),
    markdown: undefined,
  })
}

function changeTemplateDraftType(blockId, type) {
  updateTemplateDraft(blockId, {
    type,
    checked: type === 'task' ? false : undefined,
    priority: type === 'task' ? 'base' : undefined,
    level: type === 'heading' ? 2 : undefined,
  })
}

async function saveTemplateDialog() {
  if (!templateDraftNote.value) return
  await mind.saveDailyTemplateFromNote(templateDraftNote.value.id, templateDraftNote.value, {
    name: templateNameDraft.value.trim() || 'Plantilla diaria',
  })
  closeTemplateDialog()
}

async function applyDailyTemplate() {
  if (!activeNote.value) return
  await mind.applyDailyTemplate(activeNote.value.id)
}

function updateActiveBlock(blockId, patch) {
  mind.updateBlock(activeNote.value.id, blockId, patch)
}

function addActiveBlock(afterBlockId, type, content = '', options = {}) {
  return mind.addBlock(activeNote.value.id, afterBlockId, type, content, options)
}

function removeActiveBlock(blockId) {
  mind.removeBlock(activeNote.value.id, blockId)
}

function changeActiveBlockType(blockId, type) {
  mind.changeBlockType(activeNote.value.id, blockId, type)
}

function editReminder(block) {
  const sourceNote = notes.value.find((note) => note.id === (block.noteId || activeNote.value?.id))
  if (block.noteLocked || sourceNote?.locked) return
  reminderBlock.value = {
    ...block,
    noteId: block.noteId || activeNote.value?.id,
  }
}

function saveReminder(value) {
  mind.updateBlock(reminderBlock.value.noteId || activeNote.value.id, reminderBlock.value.id, {
    reminder: value || null,
  })
  reminderBlock.value = null
  mind.checkDueNotifications()
}

async function createContext() {
  if (!newContextName.value.trim()) return
  await mind.openContext(newContextName.value.trim(), { contextType: newContextType.value })
  newContextName.value = ''
  newContextType.value = DEFAULT_CONTEXT_TYPE
  showContextDialog.value = false
}

async function deleteContext(name) {
  const context = mind.getContext(name)
  const detail = context?.count
    ? ` Se eliminarán también sus ${pluralize(context.count, 'mención', 'menciones')}.`
    : ''
  if (!window.confirm(`¿Eliminar @${name}?${detail} Esta acción no se puede deshacer.`)) return
  await mind.deleteContext(name)
}

async function saveContextRename() {
  if (!activeContext.value) return
  const currentName = activeContext.value.name
  const nextName = contextRenameDraft.value.trim()
  if (!nextName) {
    contextRenameDraft.value = currentName
    return
  }

  const currentKey = currentName.toLocaleLowerCase()
  const nextKey = nextName.toLocaleLowerCase()
  const mergeTarget = nextKey !== currentKey ? mind.getContext(nextName) : null
  if (mergeTarget) {
    const detail = mergeTarget.count
      ? ` El contexto final conservará @${mergeTarget.name} y reunirá también sus ${pluralize(mergeTarget.count, 'mención', 'menciones')}.`
      : ''
    if (!window.confirm(`@${currentName} se fusionará en @${mergeTarget.name}.${detail}`)) {
      contextRenameDraft.value = currentName
      return
    }
  }

  await mind.renameContext(currentName, nextName)
  contextRenameDraft.value = nextName
}

async function deleteTag(name) {
  const count = tags.value
    .filter((item) => item.name.toLocaleLowerCase() === name.toLocaleLowerCase())
    .reduce((total, item) => total + item.count, 0)
  const detail = count
    ? ` Se eliminará de ${pluralize(count, 'bloque')}.`
    : ''
  if (!window.confirm(`¿Eliminar #${name}?${detail} Esta acción no se puede deshacer.`)) return
  await mind.deleteTag(name)
  if (selectedTag.value?.toLocaleLowerCase() === name.toLocaleLowerCase()) selectedTag.value = null
}

async function saveTagDescription() {
  if (!activeTagProject.value) return
  const description = tagDescriptionDraft.value.trim().slice(0, 50)
  tagDescriptionDraft.value = description
  await mind.updateTag(activeTagProject.value.name, { description })
}

async function chooseWorkspace() {
  connectionError.value = ''
  try {
    await mind.connectWorkspace()
  } catch (error) {
    if (error.name !== 'AbortError') connectionError.value = error.message
  }
}

async function reloadWorkspace() {
  connectionError.value = ''
  try {
    await mind.reloadWorkspaceFromDisk()
  } catch (error) {
    connectionError.value = error.message
  }
}

function openRecoveryDialog() {
  recoveryError.value = ''
  showRecoveryDialog.value = true
}

async function restoreSnapshot(snapshot) {
  recoveryError.value = ''
  const label = new Date(snapshot.createdAt).toLocaleString()
  if (!window.confirm(`¿Restaurar la copia de seguridad del ${label}?`)) return
  try {
    await mind.restoreRecoverySnapshot(snapshot.id)
    showRecoveryDialog.value = false
  } catch (error) {
    recoveryError.value = error.message
  }
}

async function importMarkdownFiles(event) {
  importError.value = ''
  const files = event.target.files
  if (!files?.length) return
  try {
    await mind.importFiles(files)
  } catch (error) {
    importError.value = error.message
  } finally {
    event.target.value = ''
  }
}

async function importReflectDirectory() {
  importError.value = ''
  try {
    await mind.importDirectory()
  } catch (error) {
    if (error.name !== 'AbortError') importError.value = error.message
  }
}

async function exportWorkspace() {
  const zip = new JSZip()
  for (const note of notes.value) {
    const directory = note.kind === 'note'
      ? 'notes'
      : note.kind === 'context' ? 'contexts' : note.kind === 'tag' ? 'tags' : 'journals'
    zip.file(`${directory}/${note.filename}`, serializeNote(note))
  }
  zip.file(
    'second-mind.json',
    JSON.stringify(mind.createWorkspaceManifest(), null, 2),
  )
  const blob = await zip.generateAsync({ type: 'blob' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `second-mind-${isoDate()}.zip`
  link.click()
  URL.revokeObjectURL(url)
}

function handleShortcuts(event) {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    openSearch()
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'j') {
    event.preventDefault()
    openDate(isoDate())
  }
  if (event.key === 'Escape') {
    showSearch.value = false
    showContextDialog.value = false
    showNoteDialog.value = false
    if (showTemplateDialog.value) closeTemplateDialog()
    showMobilePanel.value = false
    showMobileMore.value = false
    reminderBlock.value = null
  }
}

onMounted(async () => {
  await mind.initialize()
  window.addEventListener('keydown', handleShortcuts)
  window.addEventListener('online', updateOnlineState)
  window.addEventListener('offline', updateOnlineState)
  window.addEventListener('pagehide', flushPendingSavesOnPageHide)
  document.addEventListener('visibilitychange', flushPendingSavesOnVisibilityChange)
  notificationTimer = window.setInterval(mind.checkDueNotifications, 60_000)
})

function updateOnlineState() {
  isOnline.value = navigator.onLine
}

function flushPendingSavesOnPageHide() {
  void mind.flushPendingSaves()
}

function flushPendingSavesOnVisibilityChange() {
  if (document.visibilityState === 'hidden') void mind.flushPendingSaves()
}

onBeforeUnmount(() => {
  cancelAssistant()
  stopAssistantTimer()
  window.removeEventListener('keydown', handleShortcuts)
  window.removeEventListener('online', updateOnlineState)
  window.removeEventListener('offline', updateOnlineState)
  window.removeEventListener('pagehide', flushPendingSavesOnPageHide)
  document.removeEventListener('visibilitychange', flushPendingSavesOnVisibilityChange)
  window.clearInterval(notificationTimer)
  window.clearTimeout(copyStateTimer)
})
</script>

<template>
  <div class="app-shell" :class="{ loading }">
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-mark">S</div>
        <div>
          <strong>Second Mind</strong>
          <span>{{ workspaceName }}</span>
        </div>
      </div>

      <button class="today-button" @click="mind.openDate(isoDate())">
        <span>◉</span>
        Ir a hoy
        <kbd>⌘ J</kbd>
      </button>

      <nav class="primary-nav">
        <button :class="{ active: currentView === 'journal' }" @click="mind.openDate(selectedDate)">
          <span>✎</span> Diario
        </button>
        <button :class="{ active: currentView === 'tasks' }" @click="navigate('tasks')">
          <span>✓</span> Tareas
          <small>{{ tasks.filter((task) => !task.checked).length }}</small>
        </button>
        <button :class="{ active: currentView === 'agenda' }" @click="navigate('agenda')">
          <span>◷</span> Agenda
          <small>{{ reminders.length }}</small>
        </button>
        <button :class="{ active: currentView === 'notes' }" @click="openNotes">
          <span>▤</span> Notas
          <small>{{ independentNotes.length }}</small>
        </button>
        <button :class="{ active: currentView === 'tracking' }" @click="navigate('tracking')">
          <span>◎</span> Seguimiento
          <small>{{ waitingTasks.length }}</small>
        </button>
        <button :class="{ active: currentView === 'assistant' }" @click="navigate('assistant')">
          <span>✦</span> Asistente
        </button>
        <button :class="{ active: currentView === 'contexts' }" @click="navigate('contexts')">
          <span>@</span> Contextos
          <small>{{ contextIndex.length }}</small>
        </button>
        <button :class="{ active: currentView === 'tags' }" @click="openTagsIndex">
          <span>#</span> Etiquetas
          <small>{{ tagProjects.length }}</small>
        </button>
        <button @click="openSearch"><span>⌕</span> Buscar <kbd>⌘ K</kbd></button>
      </nav>

      <section class="sidebar-section contexts-section">
        <div class="section-heading">
          <button class="heading-link" @click="navigate('contexts')">CONTEXTOS</button>
          <button aria-label="Nuevo contexto" @click="showContextDialog = true">＋</button>
        </div>
        <div
          v-for="context in contextIndex.slice(0, 12)"
          :key="context.name"
          class="sidebar-entity-row"
          :class="{ active: selectedContext?.toLocaleLowerCase() === context.name.toLocaleLowerCase() }"
        >
          <button class="context-link" @click="openContext(context.name)">
            <span>
              <b :class="`context-dot color-${context.color || 'sage'}`">{{ context.emoji || '◈' }}</b>
              @{{ context.name }}
            </span>
            <small>{{ context.count }}</small>
          </button>
          <button
            class="delete-entity-button"
            :aria-label="`Eliminar contexto ${context.name}`"
            :title="`Eliminar @${context.name}`"
            @click="deleteContext(context.name)"
          >×</button>
        </div>
      </section>

      <section v-if="tags.length" class="sidebar-section tags-section">
        <div class="section-heading">
          <button class="heading-link" @click="openTagsIndex">ETIQUETAS</button>
        </div>
        <div
          v-for="tag in tags.slice(0, 8)"
          :key="tag.name"
          class="sidebar-entity-row"
          :class="{ active: selectedTag === tag.name }"
        >
          <button class="tag-link" @click="openTag(tag.name)">
            <span>#{{ tag.name }}</span><small>{{ tag.count }}</small>
          </button>
          <button
            class="delete-entity-button"
            :aria-label="`Eliminar etiqueta ${tag.name}`"
            :title="`Eliminar #${tag.name}`"
            @click="deleteTag(tag.name)"
          >×</button>
        </div>
      </section>

      <div class="sidebar-footer">
        <div class="sync-line">
          <i :class="{ offline: !isOnline }"></i>{{ syncState }}
        </div>
        <div class="sync-detail">{{ workspacePersistenceLabel }}</div>
        <button
          v-if="canRestoreRecoverySnapshots"
          type="button"
          class="secondary-button recovery-button"
          @click="openRecoveryDialog"
        >Ver copias locales</button>
        <p v-if="connectionError" class="error">{{ connectionError }}</p>
        <p v-if="importError" class="error">{{ importError }}</p>
        <p v-if="recoveryError" class="error">{{ recoveryError }}</p>
      </div>
    </aside>

    <main class="workspace">
      <header class="topbar">
        <button
          class="mobile-menu-button"
          aria-label="Calendario y próximos recordatorios"
          :aria-expanded="showMobilePanel"
          title="Calendario y próximos recordatorios"
          @click="showMobileMore = false; showMobilePanel = !showMobilePanel"
        >▦</button>
        <nav class="breadcrumbs" aria-label="Ruta de navegación">
          <template v-if="breadcrumbParent">
            <button type="button" @click="openBreadcrumbParent">{{ breadcrumbParent.label }}</button>
            <b aria-hidden="true">/</b>
          </template>
          <strong aria-current="page">{{ pageTitle }}</strong>
          <button
            v-if="canCopySection"
            class="copy-section-button"
            :class="{ copied: copyState === 'copied', error: copyState === 'error' }"
            :aria-label="copyState === 'copied' ? 'Markdown copiado' : 'Copiar sección como Markdown'"
            :title="copyState === 'copied' ? 'Markdown copiado' : 'Copiar sección como Markdown'"
            @click="copyCurrentSection"
          >
            {{ copyState === 'copied' ? '✓ Copiado' : copyState === 'error' ? 'Error' : '⧉ Markdown' }}
          </button>
        </nav>
        <div class="top-actions">
          <span class="save-state">{{ syncState }}</span>
          <span class="save-detail">{{ workspacePersistenceLabel }}</span>
          <button
            class="icon-button"
            aria-label="Abrir asistente"
            title="Abrir asistente"
            @click="navigate('assistant')"
          >✦</button>
          <button
            class="icon-button theme-toggle-button"
            :aria-label="themeToggleLabel"
            :title="themeToggleLabel"
            @click="mind.toggleTheme()"
          >
            {{ theme === 'dark' ? '☼' : '◐' }}
          </button>
          <button
            class="icon-button"
            aria-label="Conectar carpeta local"
            title="Conectar carpeta local"
            @click="chooseWorkspace"
          >⎋</button>
          <button
            class="icon-button"
            aria-label="Recargar desde carpeta"
            title="Recargar desde carpeta"
            @click="reloadWorkspace"
          >↻</button>
          <button
            class="icon-button"
            aria-label="Importar Markdown o ZIP"
            title="Importar Markdown o ZIP"
            @click="importInput?.click()"
          >↥</button>
          <button
            class="icon-button"
            aria-label="Importar carpeta Reflect"
            title="Importar carpeta Reflect"
            @click="importReflectDirectory"
          >⇪</button>
          <button
            class="icon-button"
            aria-label="Exportar workspace"
            title="Exportar workspace"
            @click="exportWorkspace"
          >↓</button>
        </div>
      </header>

      <div v-if="loading" class="loading-state">
        <div class="loading-mark">S</div>
        <p>Preparando tu segundo cerebro…</p>
      </div>

      <div v-else class="main-grid">
        <section class="content-pane">
          <template v-if="currentView === 'journal' && activeNote">
            <div class="page-heading">
              <p class="eyebrow">DIARIO</p>
              <h1>
                <span class="desktop-page-title">{{ pageTitle }}</span>
                <span class="mobile-page-title">{{ compactJournalTitle }}</span>
              </h1>
              <p>
                {{ pluralize(journalEntryCount, 'entrada') }} ·
                {{ pluralize(journalContextCount, 'contexto') }}
              </p>
              <div class="page-heading-actions">
                <button v-if="canApplyDailyTemplate" class="primary-button" @click="applyDailyTemplate">
                  Usar plantilla
                </button>
                <small v-if="canApplyDailyTemplate">{{ currentDailyTemplateName }}</small>
                <button
                  class="lock-toggle-button"
                  :class="{ locked: activeNote.locked }"
                  :aria-label="activeNote.locked ? 'Desbloquear día' : 'Bloquear día'"
                  @click="toggleActiveNoteLock"
                >{{ activeNote.locked ? '🔒 Desbloquear día' : '🔓 Bloquear día' }}</button>
                <small v-if="activeNote.locked" class="lock-status" role="status">Solo lectura</small>
              </div>
            </div>
            <BlockEditor
              :note="activeNote"
              :contexts="contextIndex"
              :tags="tags"
              :read-only="activeNote.locked"
              @update-block="updateActiveBlock"
              @add-block="addActiveBlock"
              @remove-block="removeActiveBlock"
              @change-type="changeActiveBlockType"
              @edit-reminder="editReminder"
              @open-context="openContext"
              @open-tag="openTag"
            />
          </template>

          <template v-else-if="currentView === 'notes'">
            <div v-if="!activeNote" class="page-heading">
              <p class="eyebrow">NOTAS INDEPENDIENTES</p>
              <h1>Notas</h1>
              <p>Listas y páginas permanentes, separadas de tus diarios.</p>
            </div>

            <div v-if="!activeNote" class="notes-directory">
              <button class="primary-button" @click="createIndependentNote">＋ Nueva nota</button>
              <div v-if="independentNotes.length" class="note-card-list">
                <article v-for="note in independentNotes" :key="note.id" class="note-card">
                  <button @click="mind.openNote(note.id)">
                    <strong>{{ note.title }}</strong>
                    <span>{{ note.excerpt || 'Sin contenido' }}</span>
                    <small>{{ note.blocks.filter((block) => block.type === 'task' && !block.checked).length }} tareas pendientes</small>
                    <small v-if="note.locked" class="note-lock-badge">🔒 Solo lectura</small>
                  </button>
                </article>
              </div>
              <div v-else class="empty-state">Aún no tienes notas independientes.</div>
            </div>

            <template v-else-if="activeNote.kind === 'note'">
              <div class="note-editor-heading">
                <div>
                  <p class="eyebrow">NOTA INDEPENDIENTE</p>
                  <input
                    v-model="noteTitleDraft"
                    :readonly="activeNote.locked"
                    aria-label="Título de la nota"
                    @blur="saveIndependentNoteTitle"
                    @keydown.enter.prevent="saveIndependentNoteTitle"
                  >
                  <p>{{ activeNote.blocks.filter((block) => block.type !== 'heading' && block.content.trim()).length }} entradas · {{ activeNote.blocks.filter((block) => block.type === 'task' && !block.checked).length }} tareas pendientes</p>
                </div>
                <div class="note-editor-actions">
                  <button
                    class="lock-toggle-button"
                    :class="{ locked: activeNote.locked }"
                    :aria-label="activeNote.locked ? 'Desbloquear nota' : 'Bloquear nota'"
                    @click="toggleActiveNoteLock"
                  >{{ activeNote.locked ? '🔒 Desbloquear nota' : '🔓 Bloquear nota' }}</button>
                  <span v-if="activeNote.locked" class="lock-status" role="status">Solo lectura</span>
                  <button
                    class="delete-context-button"
                    :disabled="activeNote.locked"
                    :title="activeNote.locked ? 'Desbloquea la nota para eliminarla' : 'Eliminar nota'"
                    @click="deleteIndependentNote"
                  >Eliminar nota</button>
                </div>
              </div>
              <BlockEditor
                :note="activeNote"
                :contexts="contextIndex"
                :tags="tags"
                :read-only="activeNote.locked"
                @update-block="updateActiveBlock"
                @add-block="addActiveBlock"
                @remove-block="removeActiveBlock"
                @change-type="changeActiveBlockType"
                @edit-reminder="editReminder"
                @open-context="openContext"
                @open-tag="openTag"
              />
            </template>
          </template>

          <template v-else-if="currentView === 'assistant'">
            <div class="page-heading assistant-heading">
              <p class="eyebrow">SECRETARIO PERSONAL LOCAL</p>
              <h1>Asistente</h1>
              <p>Consulta tus diarios y tareas con un modelo Ollama que se ejecuta en este ordenador.</p>
            </div>

            <section class="assistant-controls" aria-label="Configuración del contexto">
              <label>
                <span>Periodo de diarios</span>
                <select v-model.number="assistantPeriod" :disabled="assistantStatus === 'thinking'">
                  <option v-for="period in ASSISTANT_PERIODS" :key="period" :value="period">
                    Últimos {{ period }} días
                  </option>
                </select>
              </label>
              <span v-if="assistantContextSummary" class="assistant-context-summary">
                {{ assistantContextSummary }}
              </span>
              <button
                v-if="assistantMessages.length"
                type="button"
                class="secondary-button"
                :disabled="assistantStatus === 'thinking'"
                @click="clearAssistantConversation"
              >Nueva conversación</button>
            </section>

            <section
              v-if="!['ready', 'thinking'].includes(assistantStatus)"
              class="assistant-setup"
            >
              <div class="assistant-status-row">
                <span class="assistant-status-dot" :class="assistantStatus"></span>
                <strong>
                  {{
                    assistantStatus === 'checking'
                      ? 'Comprobando Ollama…'
                      : assistantStatus === 'model-missing'
                        ? 'Falta el modelo configurado'
                        : 'Ollama no está conectado'
                  }}
                </strong>
              </div>
              <p v-if="assistantError" class="error">{{ assistantError }}</p>
              <ol>
                <li>Instala y abre Ollama en este ordenador.</li>
                <li>Ejecuta <code>ollama pull {{ assistantModelDraft || 'qwen3:4b' }}</code>.</li>
                <li>
                  Si usas la versión publicada, permite su origen mediante
                  <code>OLLAMA_ORIGINS</code> y reinicia Ollama.
                </li>
              </ol>
              <div class="assistant-settings">
                <label>
                  <span>Servidor local</span>
                  <input v-model.trim="assistantBaseUrlDraft" type="url" placeholder="http://localhost:11434">
                </label>
                <label>
                  <span>Modelo</span>
                  <input v-model.trim="assistantModelDraft" placeholder="qwen3:4b">
                </label>
              </div>
              <div class="assistant-setup-actions">
                <button class="primary-button" :disabled="assistantStatus === 'checking'" @click="saveAssistantConfiguration">
                  Guardar y comprobar
                </button>
                <button class="secondary-button" :disabled="assistantStatus === 'checking'" @click="checkAssistant">
                  Volver a comprobar
                </button>
              </div>
            </section>

            <section v-else class="assistant-chat" aria-live="polite">
              <div v-if="!assistantMessages.length" class="assistant-welcome">
                <span>✦</span>
                <h2>¿Qué necesitas ordenar?</h2>
                <p>Analizaré tareas abiertas de cualquier fecha y las entradas del periodo seleccionado.</p>
                <div class="assistant-suggestions">
                  <button
                    v-for="suggestion in assistantSuggestions"
                    :key="suggestion"
                    :disabled="assistantStatus === 'thinking'"
                    @click="askAssistant(suggestion)"
                  >{{ suggestion }}</button>
                </div>
              </div>

              <div v-if="assistantMessages.length" class="assistant-messages">
                <article
                  v-for="(message, index) in assistantMessages"
                  :key="index"
                  class="assistant-message"
                  :class="message.role"
                >
                  <small>{{ message.role === 'user' ? 'Tú' : 'Asistente' }}</small>
                  <p>{{ message.content }}</p>
                  <p v-if="message.insufficientEvidence" class="assistant-evidence-warning">
                    La información disponible no permite una conclusión completa.
                  </p>
                  <div v-if="message.references?.length" class="assistant-references">
                    <span>Fuentes</span>
                    <button
                      v-for="reference in message.references"
                      :key="`${reference.noteId}:${reference.blockId}`"
                      @click="openAssistantReference(reference)"
                    >
                      {{ reference.date || reference.title }} · {{ reference.content.slice(0, 54) }}
                    </button>
                  </div>
                </article>
                <article v-if="assistantStatus === 'thinking'" class="assistant-message assistant thinking">
                  <small>Asistente</small>
                  <p>
                    Revisando {{ assistantContext?.counts.included || 0 }} fuentes ·
                    {{ assistantElapsedSeconds }} s
                  </p>
                  <small class="assistant-processing-hint">
                    La primera respuesta del modelo local puede tardar hasta un minuto.
                  </small>
                </article>
              </div>

              <p v-if="assistantError" class="error assistant-chat-error">{{ assistantError }}</p>
              <form class="assistant-composer" @submit.prevent="askAssistant()">
                <textarea
                  v-model="assistantQuestion"
                  rows="2"
                  :disabled="assistantStatus === 'thinking'"
                  placeholder="Pregunta por prioridades, seguimientos, proyectos o contextos…"
                  @keydown.meta.enter.prevent="askAssistant()"
                  @keydown.ctrl.enter.prevent="askAssistant()"
                ></textarea>
                <button
                  v-if="assistantStatus !== 'thinking'"
                  type="submit"
                  class="primary-button"
                  :disabled="!assistantQuestion.trim()"
                >Preguntar</button>
                <button v-else type="button" class="secondary-button" @click="cancelAssistant">
                  Cancelar
                </button>
              </form>
              <p class="assistant-privacy">Procesamiento local · La conversación no se guarda.</p>
            </section>
          </template>

          <template v-else-if="currentView === 'tasks'">
            <div class="page-heading">
              <p class="eyebrow">TAREAS</p>
              <h1>Tareas</h1>
              <p>Acciones concretas reunidas por estado, contexto, prioridad y proyecto.</p>
            </div>
            <div class="filter-bar">
              <div class="status-filters" aria-label="Estado de las tareas">
                <button
                  v-for="filter in ['open', 'today', 'completed', 'all']"
                  :key="filter"
                  :class="{ active: taskFilter === filter }"
                  @click="taskFilter = filter"
                >{{ { open: 'Pendientes', today: 'Hoy', completed: 'Completadas', all: 'Todas' }[filter] }}</button>
              </div>
              <div class="task-filter-selects">
                <label>
                  <span>Contexto</span>
                  <select v-model="contextFilter" aria-label="Filtrar tareas por contexto">
                    <option value="all">Todos</option>
                    <option v-for="context in contextIndex" :key="context.name" :value="context.name">
                      @{{ context.name }}
                    </option>
                  </select>
                </label>
                <label>
                  <span>Prioridad</span>
                  <select v-model="priorityFilter" aria-label="Filtrar tareas por prioridad">
                    <option value="all">Todas</option>
                    <option value="high">Alta</option>
                    <option value="medium">Media</option>
                    <option value="base">Base</option>
                  </select>
                </label>
                <label>
                  <span>Etiqueta</span>
                  <select
                    :value="selectedTag || 'all'"
                    aria-label="Filtrar tareas por etiqueta"
                    @change="selectedTag = $event.target.value === 'all' ? null : $event.target.value"
                  >
                    <option value="all">Todas</option>
                    <option v-for="tag in tags" :key="tag.name" :value="tag.name">
                      #{{ tag.name }}
                    </option>
                  </select>
                </label>
              </div>
              <div class="filter-summary">
                <span>{{ pluralize(filteredTasks.length, 'resultado') }}</span>
                <div>
                  <button
                    v-if="selectedTag"
                    class="delete-filter-entity-button"
                    @click="deleteTag(selectedTag)"
                  >Eliminar #{{ selectedTag }}</button>
                  <button v-if="hasTaskFilters" class="clear-filters-button" @click="clearTaskFilters">
                    Limpiar filtros
                  </button>
                </div>
              </div>
            </div>
            <div v-if="filteredTasks.length" class="task-list">
              <article
                v-for="task in filteredTasks"
                :key="task.id"
                class="task-card"
                :class="{ completed: task.checked, locked: task.noteLocked }"
              >
                <button
                  class="task-toggle"
                  :disabled="task.noteLocked"
                  :title="task.noteLocked ? 'Día bloqueado' : undefined"
                  :aria-label="task.checked ? 'Reabrir tarea' : 'Completar tarea'"
                  :aria-pressed="task.checked"
                  @click="mind.updateBlock(task.noteId, task.id, { checked: !task.checked })"
                >{{ task.checked ? '✓' : '' }}</button>
                <div @click="openTask(task)">
                  <RichText :text="task.content" @context="openContext" @tag="openTag" />
                  <small>
                    <span
                      v-if="priorityLabel(task.priority)"
                      class="priority-badge"
                      :class="`priority-${task.priority}`"
                    >{{ task.priority === 'high' ? '↑↑' : '↑' }} {{ priorityLabel(task.priority) }}</span>
                    {{
                      task.noteDate
                        ? `Diario · ${formatReminderDate(task.noteDate, { short: true })}`
                        : task.noteTitle
                    }}
                  </small>
                </div>
                <button
                  class="reminder-button"
                  :disabled="task.noteLocked"
                  :title="task.noteLocked ? 'Día bloqueado' : undefined"
                  @click="editReminder(task)"
                >
                  {{ task.reminder ? `◷ ${formatReminderDate(task.reminder)}` : '＋ fecha' }}
                </button>
              </article>
            </div>
            <div v-else class="empty-state">No hay tareas para estos filtros.</div>
          </template>

          <template v-else-if="currentView === 'agenda'">
            <div class="page-heading">
              <p class="eyebrow">TIEMPO Y COMPROMISOS</p>
              <h1>Agenda</h1>
              <p>Recordatorios nacidos dentro de tus notas, reunidos aquí.</p>
            </div>
            <div class="agenda-groups">
              <section v-for="(items, state) in reminderGroups" :key="state">
                <header>
                  <h2>{{ { overdue: 'Vencidos', today: 'Hoy', upcoming: 'Próximos' }[state] }}</h2>
                  <span>{{ items.length }}</span>
                </header>
                <article
                  v-for="block in items"
                  :key="block.id"
                  class="agenda-item"
                  :class="{ locked: block.noteLocked }"
                >
                  <time>{{ formatReminderDate(block.reminder) }}</time>
                  <button @click="openTask(block)">
                    <RichText :text="block.content" @context="openContext" @tag="openTag" />
                  </button>
                  <button
                    aria-label="Reprogramar"
                    :disabled="block.noteLocked"
                    :title="block.noteLocked ? 'Día bloqueado' : undefined"
                    @click="editReminder(block)"
                  >•••</button>
                </article>
                <p v-if="!items.length">Nada por aquí.</p>
              </section>
            </div>
          </template>

          <template v-else-if="currentView === 'tracking'">
            <div class="page-heading">
              <p class="eyebrow">VISIÓN TRANSVERSAL</p>
              <h1>Seguimiento</h1>
              <p>Compromisos delegados o pendientes de terceros, separados de tus tareas.</p>
            </div>

            <section class="tracking-section">
              <div class="section-title"><h2>Delegado o esperando</h2><span>{{ waitingTasks.length }}</span></div>
              <article
                v-for="task in waitingTasks"
                :key="task.id"
                class="task-card compact"
                :class="{ locked: task.noteLocked }"
              >
                <button
                  class="task-toggle"
                  :disabled="task.noteLocked"
                  :title="task.noteLocked ? 'Día bloqueado' : undefined"
                  aria-label="Resolver seguimiento"
                  :aria-pressed="false"
                  @click="mind.updateBlock(task.noteId, task.id, { checked: true })"
                ></button>
                <div @click="openTask(task)">
                  <RichText :text="task.content" @context="openContext" @tag="openTag" />
                  <small>
                    <span
                      v-if="priorityLabel(task.priority)"
                      class="priority-badge"
                      :class="`priority-${task.priority}`"
                    >{{ task.priority === 'high' ? '↑↑' : '↑' }} {{ priorityLabel(task.priority) }}</span>
                    {{ task.noteDate || task.noteTitle }}
                  </small>
                </div>
                <button
                  class="reminder-button"
                  :disabled="task.noteLocked"
                  :title="task.noteLocked ? 'Día bloqueado' : undefined"
                  @click="editReminder(task)"
                >◷</button>
              </article>
              <p v-if="!waitingTasks.length" class="empty-copy">
                Añade #delegado o #esperando a una tarea para verla aquí.
              </p>
            </section>

            <section v-if="supportContexts.length" class="tracking-section">
              <div class="section-title"><h2>Equipos y áreas</h2><span>{{ supportContexts.length }}</span></div>
              <div class="tracking-grid">
                <button v-for="context in supportContexts" :key="context.name" @click="openContext(context.name)">
                  <b :class="`context-dot color-${context.color || 'sage'}`">{{ context.emoji || '◈' }}</b>
                  <span><strong>@{{ context.name }}</strong><small>{{ context.openTasks }} tareas · {{ context.count }} menciones</small></span>
                </button>
              </div>
            </section>

            <section class="tracking-section">
              <div class="section-title"><h2>Personas relacionadas</h2><span>{{ peopleContexts.length }}</span></div>
              <div class="tracking-grid people">
                <button v-for="person in peopleContexts" :key="person.name" @click="openContext(person.name)">
                  <b class="context-dot color-blue">{{ person.emoji || '●' }}</b>
                  <span><strong>@{{ person.name }}</strong><small>{{ person.openTasks }} compromisos abiertos</small></span>
                </button>
              </div>
              <p v-if="!peopleContexts.length" class="empty-copy">
                Crea contextos de tipo Persona para reunir conversaciones, acuerdos y seguimientos.
              </p>
            </section>
          </template>

          <template v-else-if="currentView === 'contexts'">
            <div class="page-heading">
              <p class="eyebrow">MAPA COMPLETO</p>
              <h1>Contextos</h1>
              <p>{{ pluralize(contextIndex.length, 'contexto') }} conectados con notas, tareas y actividad.</p>
            </div>

            <div v-if="contextIndex.length" class="context-groups">
              <section
                v-for="group in groupedContexts"
                :key="group.type"
                class="context-group"
              >
                <div class="section-title">
                  <h2>{{ group.label }}</h2>
                  <span>{{ group.contexts.length }}</span>
                </div>
                <div class="entity-directory context-directory">
                  <button
                    v-for="context in group.contexts"
                    :key="context.name"
                    :class="`context-${context.color || 'sage'}`"
                    @click="openContext(context.name)"
                  >
                    <b :class="`context-dot color-${context.color || 'sage'}`">{{ context.emoji || '◈' }}</b>
                    <span>
                      <strong>@{{ context.name }}</strong>
                      <small>{{ contextTypes[context.contextType || DEFAULT_CONTEXT_TYPE] }} · {{ context.openTasks }} abiertas · {{ context.count }} menciones</small>
                    </span>
                  </button>
                </div>
              </section>
            </div>
            <div v-else class="empty-state">Aún no hay contextos.</div>
          </template>

          <template v-else-if="currentView === 'tags'">
            <div v-if="!activeTagProject" class="page-heading">
              <p class="eyebrow">PROYECTOS POR ETIQUETA</p>
              <h1>Etiquetas / Proyectos</h1>
              <p>{{ pluralize(tagProjects.length, 'etiqueta') }} con tareas, progreso y bitácora.</p>
            </div>

            <div v-if="!activeTagProject && tagProjects.length" class="project-board">
              <article
                v-for="tag in tagProjects"
                :key="tag.name"
                class="project-card"
              >
                <button class="project-card-main" @click="openTag(tag.name)">
                  <span>
                    <small>Proyecto</small>
                    <strong>#{{ tag.name }}</strong>
                  </span>
                </button>
                <p v-if="tag.description" class="project-description">{{ tag.description }}</p>
                <div class="project-progress" :style="{ '--project-progress': `${tag.progressPercent}%` }">
                  <div>
                    <span>{{ tag.completedTasks }}/{{ tag.totalTasks }}</span>
                    <small>tareas completadas</small>
                  </div>
                  <i></i>
                </div>
                <div class="project-stats">
                  <span>{{ tag.openTasks.length }} abiertas</span>
                  <span>{{ tag.count }} menciones</span>
                  <span>{{ tag.progressPercent }}%</span>
                </div>
                <div v-if="tag.upcomingTasks.length" class="project-preview">
                  <strong>Próximas</strong>
                  <button
                    v-for="task in tag.upcomingTasks"
                    :key="task.id"
                    @click="openTask(task)"
                  >
                    <time>{{ formatReminderDate(task.reminder, { short: true, year: false }) }}</time>
                    <span>{{ task.content }}</span>
                  </button>
                </div>
                <div v-if="tag.recentBlocks.length" class="project-preview">
                  <strong>Bitácora</strong>
                  <button
                    v-for="block in tag.recentBlocks"
                    :key="block.id"
                    @click="openTask(block)"
                  >
                    <time>{{ block.noteDate || block.noteTitle }}</time>
                    <span>{{ block.content }}</span>
                  </button>
                </div>
              </article>
            </div>
            <div v-else-if="!activeTagProject" class="empty-state">Aún no hay etiquetas.</div>

            <template v-if="activeTagProject">
              <div class="tag-hero">
                <span>#</span>
                <div>
                  <p class="eyebrow">PROYECTO</p>
                  <h1>#{{ activeTagProject.name }}</h1>
                  <p v-if="activeTagProject.description" class="tag-summary">{{ activeTagProject.description }}</p>
                  <p>
                    {{ activeTagProject.completedTasks }}/{{ activeTagProject.totalTasks }} tareas completadas ·
                    {{ activeTagOpenTasks.length }} abiertas ·
                    {{ activeTagProject.count }} menciones
                  </p>
                  <label class="tag-note-control">
                    Nota breve
                    <input
                      v-model="tagDescriptionDraft"
                      type="text"
                      maxlength="50"
                      placeholder="Añade una pequeña connotación"
                      @blur="saveTagDescription"
                      @keydown.enter.prevent="$event.target.blur()"
                    />
                    <small>{{ tagDescriptionDraft.length }}/50</small>
                  </label>
                  <div class="project-progress context-progress" :style="{ '--project-progress': `${activeTagProject.progressPercent}%` }">
                    <div>
                      <span>{{ activeTagProject.progressPercent }}%</span>
                      <small>avance</small>
                    </div>
                    <i></i>
                  </div>
                  <div class="tag-hero-actions">
                    <button class="primary-button" @click="viewTagTasks(activeTagProject.name)">Ver tareas</button>
                    <button class="secondary-button" @click="selectedTag = null">Todas las etiquetas</button>
                    <button class="delete-context-button" @click="deleteTag(activeTagProject.name)">
                      Eliminar etiqueta
                    </button>
                  </div>
                </div>
              </div>

              <section class="context-section">
                <div class="section-title"><h2>Tareas abiertas</h2><span>{{ activeTagOpenTasks.length }}</span></div>
                <article
                  v-for="task in activeTagOpenTasks"
                  :key="task.id"
                  class="task-card compact"
                  :class="{ locked: task.noteLocked }"
                >
                  <button
                    class="task-toggle"
                    :disabled="task.noteLocked"
                    :title="task.noteLocked ? 'Día bloqueado' : undefined"
                    aria-label="Completar tarea"
                    :aria-pressed="false"
                    @click="mind.updateBlock(task.noteId, task.id, { checked: true })"
                  ></button>
                  <div @click="openTask(task)">
                    <RichText :text="task.content" @context="openContext" @tag="openTag" />
                    <small>{{ task.noteDate || task.noteTitle }}</small>
                  </div>
                  <button
                    class="reminder-button"
                    :disabled="task.noteLocked"
                    :title="task.noteLocked ? 'Día bloqueado' : undefined"
                    @click="editReminder(task)"
                  >◷</button>
                </article>
                <p v-if="!activeTagOpenTasks.length" class="empty-copy">No hay tareas abiertas para este proyecto.</p>
              </section>

              <section class="context-section">
                <div class="section-title"><h2>Tareas completadas</h2><span>{{ activeTagCompletedTasks.length }}</span></div>
                <article
                  v-for="task in activeTagCompletedTasks"
                  :key="task.id"
                  class="task-card compact completed"
                  :class="{ locked: task.noteLocked }"
                >
                  <button
                    class="task-toggle"
                    :disabled="task.noteLocked"
                    :title="task.noteLocked ? 'Día bloqueado' : undefined"
                    aria-label="Reabrir tarea"
                    :aria-pressed="true"
                    @click="mind.updateBlock(task.noteId, task.id, { checked: false })"
                  >✓</button>
                  <div @click="openTask(task)">
                    <RichText :text="task.content" @context="openContext" @tag="openTag" />
                    <small>{{ task.noteDate || task.noteTitle }}</small>
                  </div>
                </article>
                <p v-if="!activeTagCompletedTasks.length" class="empty-copy">Todavía no hay tareas completadas.</p>
              </section>

              <section class="context-section">
                <div class="section-title"><h2>Bitácora</h2><span>{{ activeTagRecentBlocks.length }}</span></div>
                <div class="activity-timeline">
                  <article
                    v-for="block in activeTagRecentBlocks"
                    :key="block.id"
                    :class="{ 'activity-child': block.tagIndent > 0 }"
                    :style="{ '--context-indent': Math.min(block.tagIndent || 0, 6) }"
                    @click="openTask(block)"
                  >
                    <time v-if="!block.tagIndent">{{ block.noteDate || block.noteTitle }}</time>
                    <p><RichText :text="block.content" @context="openContext" @tag="openTag" /></p>
                  </article>
                </div>
                <p v-if="!activeTagRecentBlocks.length" class="empty-copy">Aún no hay logs para esta etiqueta.</p>
              </section>
            </template>
          </template>

          <template v-else-if="currentView === 'context' && activeContext">
            <div class="context-hero" :class="`context-${activeContext.color || 'sage'}`">
              <span>{{ activeContext.emoji || '◈' }}</span>
              <div>
                <p class="eyebrow">CONTEXTO</p>
                <h1>@{{ activeContext.name }}</h1>
                <p>{{ activeContext.count }} menciones · {{ activeContext.openTasks }} tareas abiertas</p>
                <label class="context-rename-control">
                  Nombre
                  <input
                    v-model="contextRenameDraft"
                    aria-label="Renombrar contexto"
                    placeholder="@equipo"
                    @keydown.enter.prevent="saveContextRename"
                  />
                  <button class="context-action-button" @click="saveContextRename">
                    Renombrar contexto
                  </button>
                </label>
                <label class="context-type-control">
                  Tipo
                  <select
                    :value="activeContext.contextType || DEFAULT_CONTEXT_TYPE"
                    @change="mind.updateContext(activeContext.noteId, { contextType: $event.target.value })"
                  >
                    <option v-for="(label, value) in contextTypes" :key="value" :value="value">{{ label }}</option>
                  </select>
                </label>
                <button class="delete-context-button" @click="deleteContext(activeContext.name)">
                  Eliminar contexto
                </button>
              </div>
            </div>

            <section v-if="contextTasks.length" class="context-section">
              <div class="section-title">
                <h2>Tareas abiertas</h2>
                <span>{{ contextTasks.length }}</span>
              </div>
              <article
                v-for="task in contextTasks"
                :key="task.id"
                class="task-card compact"
                :class="{ locked: task.noteLocked }"
              >
                <button
                  class="task-toggle"
                  :disabled="task.noteLocked"
                  :title="task.noteLocked ? 'Día bloqueado' : undefined"
                  aria-label="Completar tarea"
                  :aria-pressed="false"
                  @click="mind.updateBlock(task.noteId, task.id, { checked: true })"
                ></button>
                <div @click="openTask(task)">
                  <RichText :text="task.content" @context="openContext" @tag="openTag" />
                  <small>
                    <span
                      v-if="priorityLabel(task.priority)"
                      class="priority-badge"
                      :class="`priority-${task.priority}`"
                    >{{ task.priority === 'high' ? '↑↑' : '↑' }} {{ priorityLabel(task.priority) }}</span>
                    {{ task.noteDate }}
                  </small>
                </div>
                <button
                  class="reminder-button"
                  :disabled="task.noteLocked"
                  :title="task.noteLocked ? 'Día bloqueado' : undefined"
                  @click="editReminder(task)"
                >◷</button>
              </article>
            </section>

            <section class="context-section">
              <div class="section-title">
                <h2>Actividad reciente</h2>
                <span>{{ activeContextBlocks.length }}</span>
              </div>
              <div class="activity-timeline">
                <article
                  v-for="block in activeContextBlocks"
                  :key="block.id"
                  :class="{ 'activity-child': block.contextIndent > 0 }"
                  :style="{ '--context-indent': Math.min(block.contextIndent || 0, 6) }"
                  @click="openTask(block)"
                >
                  <time v-if="!block.contextIndent">{{ block.noteDate || block.noteTitle }}</time>
                  <p><RichText :text="block.content" @context="openContext" @tag="openTag" /></p>
                </article>
              </div>
            </section>
          </template>
        </section>

        <aside class="right-panel" :class="{ mobileOpen: showMobilePanel }">
          <button
            v-if="showMobilePanel"
            class="mobile-panel-close"
            aria-label="Cerrar calendario"
            @click="showMobilePanel = false"
          >×</button>
          <CalendarPanel
            :selected-date="selectedDate"
            :journals="journals"
            :reminders="reminders"
            @select="openDate"
          />
          <section class="right-section">
            <div class="section-heading"><span>PRÓXIMOS</span></div>
            <button
              v-for="block in reminders.slice(0, 5)"
              :key="block.id"
              class="upcoming-link"
              @click="openTask(block)"
            >
              <time>{{ formatReminderDate(block.reminder, { short: true, year: false }) }}</time>
              <span>{{ block.content }}</span>
            </button>
            <p v-if="!reminders.length" class="empty-copy">No tienes recordatorios pendientes.</p>
          </section>
          <section v-if="currentView === 'context'" class="right-section">
            <div class="section-heading"><span>ETIQUETAS FRECUENTES</span></div>
            <div class="tag-cloud">
              <button v-for="tag in contextTags" :key="tag.name" @click="openTag(tag.name)">
                #{{ tag.name }} <small>{{ tag.count }}</small>
              </button>
            </div>
          </section>
          <section class="right-section">
            <div class="section-heading"><span>DATOS</span></div>
            <dl class="stats-list">
              <div><dt>Notas</dt><dd>{{ notes.length }}</dd></div>
              <div><dt>Tareas abiertas</dt><dd>{{ tasks.filter((task) => !task.checked).length }}</dd></div>
              <div><dt>Proyectos</dt><dd>{{ tagProjects.length }}</dd></div>
              <div><dt>Cambios offline</dt><dd>{{ syncState.includes('Pendiente') ? 'Sí' : 'No' }}</dd></div>
            </dl>
          </section>
        </aside>
      </div>
    </main>

    <button
      v-if="showMobilePanel"
      class="mobile-panel-backdrop"
      aria-label="Cerrar el calendario tocando fuera"
      @click="showMobilePanel = false"
    ></button>

    <button
      v-if="showMobileMore"
      class="mobile-more-backdrop"
      aria-label="Cerrar el menú Más"
      @click="showMobileMore = false"
    ></button>

    <section
      v-if="showMobileMore"
      id="mobile-more-menu"
      class="mobile-more-sheet"
      role="dialog"
      aria-label="Más secciones"
    >
      <div class="mobile-more-heading">
        <strong>Más secciones</strong>
        <button aria-label="Cerrar el menú Más" @click="showMobileMore = false">×</button>
      </div>
      <div class="mobile-more-grid">
        <button @click="openSearch"><span>⌕</span><b>Buscar</b></button>
        <button :class="{ active: currentView === 'tags' }" @click="openTagsIndex"><span>#</span><b>Etiquetas</b></button>
        <button :class="{ active: currentView === 'tracking' }" @click="navigate('tracking')"><span>◎</span><b>Seguimiento</b></button>
        <button :class="{ active: currentView === 'assistant' }" @click="navigate('assistant')"><span>✦</span><b>Asistente</b></button>
        <button :class="{ active: currentView === 'contexts' || currentView === 'context' }" @click="navigate('contexts')"><span>@</span><b>Contextos</b></button>
      </div>
    </section>

    <nav class="mobile-nav" aria-label="Navegación principal">
      <button :class="{ active: currentView === 'journal' }" @click="openDate(isoDate())"><span>✎</span>Hoy</button>
      <button :class="{ active: currentView === 'tasks' }" @click="navigate('tasks')"><span>✓</span>Tareas</button>
      <button :class="{ active: currentView === 'agenda' }" @click="navigate('agenda')"><span>◷</span>Agenda</button>
      <button :class="{ active: currentView === 'notes' }" @click="openNotes"><span>▤</span>Notas</button>
      <button
        :class="{ active: mobileMoreActive || showMobileMore }"
        :aria-expanded="showMobileMore"
        aria-controls="mobile-more-menu"
        @click="toggleMobileMore"
      ><span>•••</span>Más</button>
    </nav>

    <div v-if="showSearch" class="modal-backdrop" @click.self="showSearch = false">
      <div class="search-modal">
        <div class="search-box">
          <span>⌕</span>
          <input
            v-model="searchQuery"
            class="search-input"
            placeholder="Busca bloques, @contextos o #etiquetas…"
            @keydown.esc="showSearch = false"
            @keydown.enter.prevent="openFirstSearchResult"
          />
          <kbd>ESC</kbd>
        </div>
        <div class="search-results">
          <button
            v-for="context in searchContextResults"
            :key="`context-${context.name}`"
            @click="openSearchContext(context.name)"
          >
            <b :class="`context-dot color-${context.color || 'sage'}`">{{ context.emoji || '◈' }}</b>
            <span>
              <strong>@{{ context.name }}</strong>
              <small>{{ contextTypes[context.contextType || DEFAULT_CONTEXT_TYPE] }} · {{ context.count }} menciones</small>
            </span>
          </button>
          <button
            v-for="block in searchResults"
            :key="block.id"
            @click="openTask(block); showSearch = false"
          >
            <span class="result-icon">{{ block.type === 'task' ? '✓' : '•' }}</span>
            <span>
              <strong><RichText :text="block.content" /></strong>
              <small>{{ block.noteDate || block.noteTitle }}</small>
            </span>
          </button>
          <p
            v-if="searchQuery && !searchResults.length && !searchContextResults.length"
            class="search-prompt"
          >No hay resultados.</p>
          <p v-if="!searchQuery" class="search-prompt">Todo tu trabajo, a una búsqueda de distancia.</p>
        </div>
      </div>
    </div>

    <div v-if="showContextDialog" class="modal-backdrop" @click.self="showContextDialog = false">
      <form class="small-modal" @submit.prevent="createContext">
        <p class="eyebrow">NUEVO CONTEXTO</p>
        <h2>Crea una persona, equipo o zona del mapa</h2>
        <input v-model="newContextName" autofocus placeholder="motor, hogar, Sara…" />
        <label>
          Tipo de contexto
          <select v-model="newContextType">
            <option v-for="(label, value) in contextTypes" :key="value" :value="value">{{ label }}</option>
          </select>
        </label>
        <div>
          <button type="button" class="secondary-button" @click="showContextDialog = false">Cancelar</button>
          <button class="primary-button">Crear @camino</button>
        </div>
      </form>
    </div>

    <div v-if="showNoteDialog" class="modal-backdrop" @click.self="showNoteDialog = false">
      <form class="small-modal" @submit.prevent="confirmCreateIndependentNote">
        <p class="eyebrow">NUEVA NOTA</p>
        <h2>Crea una lista o página permanente</h2>
        <input v-model="newNoteTitle" class="new-note-title" autofocus placeholder="Inicio del día, Ideas…" />
        <div>
          <button type="button" class="secondary-button" @click="showNoteDialog = false">Cancelar</button>
          <button class="primary-button" :disabled="!newNoteTitle.trim()">Crear nota</button>
        </div>
      </form>
    </div>

    <div v-if="showTemplateDialog" class="modal-backdrop template-modal-backdrop" @click.self="closeTemplateDialog">
      <div class="search-modal template-modal">
        <div class="template-modal-header">
          <div>
            <p class="eyebrow">PLANTILLA DIARIA</p>
            <h2>Base personal para los días nuevos</h2>
          </div>
          <button type="button" class="secondary-button" @click="closeTemplateDialog">Cerrar</button>
        </div>
        <div class="template-modal-body">
          <label>
            Nombre visible
            <input v-model="templateNameDraft" maxlength="60" placeholder="Plantilla diaria" />
          </label>
          <p class="template-modal-copy">
            Esta versión admite una plantilla activa, pero queda preparada para que más adelante puedas guardar varias.
          </p>
          <BlockEditor
            v-if="templateDraftNote"
            :note="templateDraftNote"
            :contexts="contextIndex"
            :tags="tags"
            @update-block="updateTemplateDraft"
            @add-block="addTemplateDraftBlock"
            @remove-block="removeTemplateDraftBlock"
            @change-type="changeTemplateDraftType"
          />
        </div>
        <div class="template-modal-footer">
          <small>{{ pluralize(dailyTemplates.length, 'plantilla') }} configurada</small>
          <div>
            <button type="button" class="secondary-button" @click="closeTemplateDialog">Cancelar</button>
            <button type="button" class="primary-button" @click="saveTemplateDialog">Guardar plantilla</button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="showRecoveryDialog" class="modal-backdrop" @click.self="showRecoveryDialog = false">
      <div class="small-modal recovery-modal">
        <p class="eyebrow">RECUPERACIÓN LOCAL</p>
        <h2>Restaura una copia de seguridad reciente</h2>
        <label>
          Copias disponibles
          <div class="recovery-list">
            <button
              v-for="snapshot in recoverySnapshots"
              :key="snapshot.id"
              type="button"
              class="recovery-item"
              @click="restoreSnapshot(snapshot)"
            >
              <strong>{{ new Date(snapshot.createdAt).toLocaleString() }}</strong>
              <span>{{ snapshot.noteCount }} notas · {{ snapshot.reason }}</span>
            </button>
          </div>
        </label>
        <p v-if="recoveryError" class="error">{{ recoveryError }}</p>
        <div>
          <button type="button" class="secondary-button" @click="showRecoveryDialog = false">Cerrar</button>
        </div>
      </div>
    </div>

    <ReminderDialog
      :block="reminderBlock"
      @close="reminderBlock = null"
      @save="saveReminder"
    />

    <input
      ref="importInput"
      class="visually-hidden"
      type="file"
      accept=".md,.zip,text/markdown,application/zip"
      multiple
      @change="importMarkdownFiles"
    />

    <div v-if="conflicts.length" class="conflict-banner">
      Hay {{ conflicts.length }} conflicto(s) conservado(s) para resolver cuando conectemos el servidor.
    </div>

    <div v-if="updateAvailable" class="update-banner">
      <span>Hay una nueva versión disponible. Tus datos locales no se enviarán durante la actualización.</span>
      <button @click="updateSW(true)">Actualizar</button>
      <button @click="updateAvailable = false">Ahora no</button>
    </div>
  </div>
</template>
