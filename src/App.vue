<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import JSZip from 'jszip'
import { registerSW } from 'virtual:pwa-register'
import BlockEditor from './components/BlockEditor.vue'
import CalendarPanel from './components/CalendarPanel.vue'
import ReminderDialog from './components/ReminderDialog.vue'
import RichText from './components/RichText.vue'
import {
  formatReminderDate,
  DEFAULT_CONTEXT_TYPE,
  isoDate,
  reminderDate,
  serializeContextShare,
  serializeJournalShare,
  serializeNote,
  sortContextBlocksByDate,
} from './lib/markdown'
import { isTrackingTask } from './lib/taskClassification'
import { contextTypes, useSecondMind } from './composables/useSecondMind'

const mind = useSecondMind()
const {
  notes,
  journals,
  activeNote,
  currentView,
  selectedDate,
  selectedContext,
  loading,
  syncState,
  workspaceName,
  conflicts,
  tasks,
  reminders,
  contextIndex,
  tags,
} = mind

const searchQuery = ref('')
const showSearch = ref(false)
const showContextDialog = ref(false)
const showMobilePanel = ref(false)
const newContextName = ref('')
const newContextType = ref(DEFAULT_CONTEXT_TYPE)
const selectedTag = ref(null)
const taskFilter = ref('open')
const contextFilter = ref('all')
const priorityFilter = ref('all')
const priorityRank = { high: 0, medium: 1, base: 2 }
const reminderBlock = ref(null)
const importInput = ref(null)
const connectionError = ref('')
const copyState = ref('idle')
const isOnline = ref(navigator.onLine)
const updateAvailable = ref(false)
const updateSW = registerSW({
  onNeedRefresh() {
    updateAvailable.value = true
  },
})
let notificationTimer
let copyStateTimer

const pageTitle = computed(() => {
  if (currentView.value === 'journal') {
    return new Date(`${selectedDate.value}T12:00:00`).toLocaleDateString(undefined, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
  }
  if (currentView.value === 'context') return `@${selectedContext.value}`
  if (currentView.value === 'tasks') return 'Misiones Secundarias'
  if (currentView.value === 'agenda') return 'Agenda'
  if (currentView.value === 'missions') return 'Misiones Principales'
  if (currentView.value === 'tracking') return 'Seguimiento'
  return 'Second Mind'
})

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
const contextAllTasks = computed(() =>
  activeContextBlocks.value.filter((block) => block.type === 'task'),
)
const activeContextProgress = computed(() => {
  const total = contextAllTasks.value.length
  const completed = contextAllTasks.value.filter((task) => task.checked).length
  return {
    completed,
    total,
    percent: total ? Math.round((completed / total) * 100) : 0,
  }
})
const activeContextUpcomingTasks = computed(() =>
  contextTasks.value
    .filter((task) => task.reminder)
    .sort((a, b) => (a.reminder || '').localeCompare(b.reminder || ''))
    .slice(0, 3),
)
const contextTags = computed(() => {
  const counts = new Map()
  for (const block of activeContextBlocks.value) {
    for (const tag of block.tags) counts.set(tag, (counts.get(tag) || 0) + 1)
  }
  return [...counts.entries()].map(([name, count]) => ({ name, count }))
})
const mainMissions = computed(() =>
  contextIndex.value
    .filter((context) => (context.contextType || 'project') === 'project')
    .map((context) => {
      const contextBlocks = context.blocks || []
      const missionTasks = contextBlocks.filter((block) => block.type === 'task')
      const completedTasks = missionTasks.filter((task) => task.checked).length
      const upcomingTasks = missionTasks
        .filter((task) => !task.checked && task.reminder)
        .sort((a, b) => (a.reminder || '').localeCompare(b.reminder || ''))
        .slice(0, 3)
      const recentBlocks = sortContextBlocksByDate(contextBlocks)
        .filter((block) => block.content?.trim())
        .slice(0, 3)

      return {
        ...context,
        totalTasks: missionTasks.length,
        completedTasks,
        progressPercent: missionTasks.length
          ? Math.round((completedTasks / missionTasks.length) * 100)
          : 0,
        upcomingTasks,
        recentBlocks,
      }
    })
    .sort((a, b) => b.openTasks - a.openTasks || a.name.localeCompare(b.name)),
)
const supportContexts = computed(() =>
  contextIndex.value.filter((context) =>
    ['team', 'area'].includes(context.contextType || 'project'),
  ),
)
const peopleContexts = computed(() =>
  contextIndex.value.filter((context) => context.contextType === 'person'),
)
const activeContextIsMainMission = computed(() =>
  (activeContext.value?.contextType || 'project') === 'project',
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
  mind.setView(view)
  showMobilePanel.value = false
}

function openContext(name) {
  selectedTag.value = null
  mind.openContext(name)
  showMobilePanel.value = false
}

function openTag(name) {
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

async function exportWorkspace() {
  const zip = new JSZip()
  for (const note of notes.value) {
    const directory = note.kind === 'context' ? 'contexts' : 'journals'
    zip.file(`${directory}/${note.filename}`, serializeNote(note))
  }
  zip.file(
    'second-mind.json',
    JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        format: 'second-mind-v2',
        noteCount: notes.value.length,
      },
      null,
      2,
    ),
  )
  const blob = await zip.generateAsync({ type: 'blob' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `second-mind-${isoDate()}.zip`
  link.click()
  URL.revokeObjectURL(url)
}

async function enableNotifications() {
  await mind.requestNotificationPermission()
  mind.checkDueNotifications()
}

function handleShortcuts(event) {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    openSearch()
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'j') {
    event.preventDefault()
    mind.openDate(isoDate())
  }
  if (event.key === 'Escape') {
    showSearch.value = false
    showContextDialog.value = false
    showMobilePanel.value = false
    reminderBlock.value = null
  }
}

onMounted(async () => {
  await mind.initialize()
  window.addEventListener('keydown', handleShortcuts)
  window.addEventListener('online', updateOnlineState)
  window.addEventListener('offline', updateOnlineState)
  notificationTimer = window.setInterval(mind.checkDueNotifications, 60_000)
})

function updateOnlineState() {
  isOnline.value = navigator.onLine
}

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleShortcuts)
  window.removeEventListener('online', updateOnlineState)
  window.removeEventListener('offline', updateOnlineState)
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
          <span>✓</span> Secundarias
          <small>{{ tasks.filter((task) => !task.checked).length }}</small>
        </button>
        <button :class="{ active: currentView === 'agenda' }" @click="navigate('agenda')">
          <span>◷</span> Agenda
          <small>{{ reminders.length }}</small>
        </button>
        <button :class="{ active: currentView === 'missions' }" @click="navigate('missions')">
          <span>✦</span> Principales
          <small>{{ mainMissions.length }}</small>
        </button>
        <button :class="{ active: currentView === 'tracking' }" @click="navigate('tracking')">
          <span>◎</span> Seguimiento
          <small>{{ waitingTasks.length }}</small>
        </button>
        <button @click="openSearch"><span>⌕</span> Buscar <kbd>⌘ K</kbd></button>
      </nav>

      <section class="sidebar-section contexts-section">
        <div class="section-heading">
          <span>CONTEXTOS</span>
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
        <div class="section-heading"><span>ETIQUETAS</span></div>
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
        <p class="privacy-note">Con carpeta conectada, los Markdown de disco son la fuente principal.</p>
        <div class="sync-line">
          <i :class="{ offline: !isOnline }"></i>{{ syncState }}
        </div>
        <button class="workspace-button" @click="chooseWorkspace">Conectar carpeta</button>
        <button class="workspace-button secondary" @click="reloadWorkspace">Recargar carpeta</button>
        <p v-if="connectionError" class="error">{{ connectionError }}</p>
      </div>
    </aside>

    <main class="workspace">
      <header class="topbar">
        <button
          class="mobile-menu-button"
          aria-label="Calendario y próximos recordatorios"
          :aria-expanded="showMobilePanel"
          title="Calendario y próximos recordatorios"
          @click="showMobilePanel = !showMobilePanel"
        >▦</button>
        <div class="breadcrumbs">
          <span>{{ currentView }}</span><b>/</b><strong>{{ pageTitle }}</strong>
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
        </div>
        <div class="top-actions">
          <span class="save-state">{{ syncState }}</span>
          <button
            class="icon-button"
            aria-label="Activar notificaciones"
            title="Activar notificaciones"
            @click="enableNotifications"
          >♢</button>
          <button
            class="icon-button"
            aria-label="Recargar desde carpeta"
            title="Recargar desde carpeta"
            @click="reloadWorkspace"
          >↻</button>
          <button
            class="icon-button"
            aria-label="Exportar workspace"
            title="Exportar workspace"
            @click="exportWorkspace"
          >↓</button>
          <button class="primary-button" @click="chooseWorkspace">Conectar carpeta</button>
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
              <h1>{{ pageTitle }}</h1>
              <p>
                {{ pluralize(journalEntryCount, 'entrada') }} ·
                {{ pluralize(journalContextCount, 'contexto') }}
              </p>
            </div>
            <BlockEditor
              :note="activeNote"
              :contexts="contextIndex"
              :tags="tags"
              @update-block="updateActiveBlock"
              @add-block="addActiveBlock"
              @remove-block="removeActiveBlock"
              @change-type="changeActiveBlockType"
              @edit-reminder="editReminder"
              @open-context="openContext"
              @open-tag="openTag"
            />
          </template>

          <template v-else-if="currentView === 'tasks'">
            <div class="page-heading">
              <p class="eyebrow">MISIONES SECUNDARIAS</p>
              <h1>Misiones Secundarias</h1>
              <p>Acciones concretas para avanzar la aventura sin perder el día ni el contexto donde nacieron.</p>
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
                  <span>Camino</span>
                  <select v-model="contextFilter" aria-label="Filtrar misiones secundarias por contexto o misión principal">
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
                :class="{ completed: task.checked }"
              >
                <button
                  class="task-toggle"
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
                <button class="reminder-button" @click="editReminder(task)">
                  {{ task.reminder ? `◷ ${formatReminderDate(task.reminder)}` : '＋ fecha' }}
                </button>
              </article>
            </div>
            <div v-else class="empty-state">No hay misiones secundarias para estos filtros. Un pequeño milagro.</div>
          </template>

          <template v-else-if="currentView === 'missions'">
            <div class="page-heading">
              <p class="eyebrow">MISIONES PRINCIPALES</p>
              <h1>Misiones Principales</h1>
              <p>Caminos largos con secundarias, bitácora y próximos pasos en un solo mapa.</p>
            </div>

            <div v-if="mainMissions.length" class="mission-board">
              <article
                v-for="mission in mainMissions"
                :key="mission.name"
                class="mission-card"
                :class="`context-${mission.color || 'sage'}`"
              >
                <button class="mission-card-main" @click="openContext(mission.name)">
                  <b :class="`context-dot color-${mission.color || 'sage'}`">{{ mission.emoji || '✦' }}</b>
                  <span>
                    <small>Misión Principal</small>
                    <strong>@{{ mission.name }}</strong>
                  </span>
                </button>
                <div class="mission-progress" :style="{ '--mission-progress': `${mission.progressPercent}%` }">
                  <div>
                    <span>{{ mission.completedTasks }}/{{ mission.totalTasks }}</span>
                    <small>secundarias completadas</small>
                  </div>
                  <i></i>
                </div>
                <div class="mission-stats">
                  <span>{{ mission.openTasks }} abiertas</span>
                  <span>{{ mission.count }} menciones</span>
                  <span>{{ mission.progressPercent }}%</span>
                </div>
                <div v-if="mission.upcomingTasks.length" class="mission-preview">
                  <strong>Próximas</strong>
                  <button
                    v-for="task in mission.upcomingTasks"
                    :key="task.id"
                    @click="openTask(task)"
                  >
                    <time>{{ formatReminderDate(task.reminder, { short: true, year: false }) }}</time>
                    <span>{{ task.content }}</span>
                  </button>
                </div>
                <div v-else class="mission-preview muted">
                  <strong>Próximas</strong>
                  <p>Sin fecha marcada. El camino espera una señal.</p>
                </div>
                <div v-if="mission.recentBlocks.length" class="mission-preview">
                  <strong>Bitácora</strong>
                  <button
                    v-for="block in mission.recentBlocks"
                    :key="block.id"
                    @click="openTask(block)"
                  >
                    <time>{{ block.noteDate || block.noteTitle }}</time>
                    <span>{{ block.content }}</span>
                  </button>
                </div>
              </article>
            </div>
            <div v-else class="empty-state">
              Crea un contexto de tipo Misión Principal para abrir el primer camino.
            </div>
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
                <article v-for="block in items" :key="block.id" class="agenda-item">
                  <time>{{ formatReminderDate(block.reminder) }}</time>
                  <button @click="openTask(block)">
                    <RichText :text="block.content" @context="openContext" @tag="openTag" />
                  </button>
                  <button aria-label="Reprogramar" @click="editReminder(block)">•••</button>
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
              <article v-for="task in waitingTasks" :key="task.id" class="task-card compact">
                <button
                  class="task-toggle"
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
                <button class="reminder-button" @click="editReminder(task)">◷</button>
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

          <template v-else-if="currentView === 'context' && activeContext">
            <div class="context-hero" :class="`context-${activeContext.color || 'sage'}`">
              <span>{{ activeContext.emoji || '◈' }}</span>
              <div>
                <p class="eyebrow">{{ activeContextIsMainMission ? 'MISIÓN PRINCIPAL' : 'CONTEXTO' }}</p>
                <h1>@{{ activeContext.name }}</h1>
                <p v-if="activeContextIsMainMission">
                  {{ activeContextProgress.completed }}/{{ activeContextProgress.total }} secundarias completadas ·
                  {{ activeContext.openTasks }} abiertas · {{ activeContext.count }} menciones
                </p>
                <p v-else>{{ activeContext.count }} menciones · {{ activeContext.openTasks }} tareas abiertas</p>
                <div
                  v-if="activeContextIsMainMission"
                  class="mission-progress context-progress"
                  :style="{ '--mission-progress': `${activeContextProgress.percent}%` }"
                >
                  <div>
                    <span>{{ activeContextProgress.percent }}%</span>
                    <small>avance del camino</small>
                  </div>
                  <i></i>
                </div>
                <label class="context-type-control">
                  Tipo
                  <select
                    :value="activeContext.contextType || 'project'"
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
                <h2>{{ activeContextIsMainMission ? 'Misiones secundarias abiertas' : 'Tareas abiertas' }}</h2>
                <span>{{ contextTasks.length }}</span>
              </div>
              <article v-for="task in contextTasks" :key="task.id" class="task-card compact">
                <button
                  class="task-toggle"
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
                <button class="reminder-button" @click="editReminder(task)">◷</button>
              </article>
            </section>

            <section
              v-if="activeContextIsMainMission && activeContextUpcomingTasks.length"
              class="context-section"
            >
              <div class="section-title"><h2>Próximas señales</h2><span>{{ activeContextUpcomingTasks.length }}</span></div>
              <article v-for="task in activeContextUpcomingTasks" :key="task.id" class="agenda-item">
                <time>{{ formatReminderDate(task.reminder) }}</time>
                <button @click="openTask(task)">
                  <RichText :text="task.content" @context="openContext" @tag="openTag" />
                </button>
                <button aria-label="Reprogramar" @click="editReminder(task)">•••</button>
              </article>
            </section>

            <section class="context-section">
              <div class="section-title">
                <h2>{{ activeContextIsMainMission ? 'Bitácora del camino' : 'Actividad reciente' }}</h2>
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
              <div><dt>Secundarias abiertas</dt><dd>{{ tasks.filter((task) => !task.checked).length }}</dd></div>
              <div><dt>Misiones principales</dt><dd>{{ mainMissions.length }}</dd></div>
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

    <nav class="mobile-nav">
      <button :class="{ active: currentView === 'journal' }" @click="mind.openDate(isoDate())"><span>✎</span>Hoy</button>
      <button :class="{ active: currentView === 'tasks' }" @click="navigate('tasks')"><span>✓</span>Secundarias</button>
      <button @click="openSearch"><span>⌕</span>Buscar</button>
      <button :class="{ active: currentView === 'agenda' }" @click="navigate('agenda')"><span>◷</span>Agenda</button>
      <button :class="{ active: currentView === 'missions' }" @click="navigate('missions')"><span>✦</span>Principales</button>
      <button :class="{ active: currentView === 'tracking' }" @click="navigate('tracking')"><span>◎</span>Seguimiento</button>
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
              <small>{{ contextTypes[context.contextType || 'project'] }} · {{ context.count }} menciones</small>
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
        <p class="eyebrow">NUEVO CAMINO</p>
        <h2>Crea una misión, persona o zona del mapa</h2>
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
      @change="mind.importFiles($event.target.files)"
    />

    <button
      class="floating-import"
      aria-label="Importar Markdown"
      title="Importar Markdown"
      @click="importInput?.click()"
    >↥</button>

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
