<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import JSZip from 'jszip'
import { registerSW } from 'virtual:pwa-register'
import BlockEditor from './components/BlockEditor.vue'
import CalendarPanel from './components/CalendarPanel.vue'
import ReminderDialog from './components/ReminderDialog.vue'
import RichText from './components/RichText.vue'
import { formatReminderDate, isoDate, reminderDate, serializeNote } from './lib/markdown'
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
const newContextType = ref('project')
const selectedTag = ref(null)
const taskFilter = ref('open')
const contextFilter = ref('all')
const reminderBlock = ref(null)
const importInput = ref(null)
const connectionError = ref('')
const isOnline = ref(navigator.onLine)
const updateAvailable = ref(false)
const updateSW = registerSW({
  onNeedRefresh() {
    updateAvailable.value = true
  },
})
let notificationTimer

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
  if (currentView.value === 'tasks') return 'Tareas'
  if (currentView.value === 'agenda') return 'Agenda'
  if (currentView.value === 'tracking') return 'Seguimiento'
  return 'Second Mind'
})

const filteredTasks = computed(() =>
  tasks.value.filter((task) => {
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
    if (selectedTag.value && !task.tags.includes(selectedTag.value)) return false
    return true
  }),
)

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
const projectContexts = computed(() =>
  contextIndex.value.filter((context) =>
    ['project', 'team', 'area'].includes(context.contextType || 'project'),
  ),
)
const peopleContexts = computed(() =>
  contextIndex.value.filter((context) => context.contextType === 'person'),
)
const waitingTasks = computed(() =>
  tasks.value.filter(
    (task) =>
      !task.checked &&
      (task.tags.some((tag) => ['esperando', 'delegado', 'follow-up'].includes(tag.toLocaleLowerCase())) ||
        task.contexts.some((name) =>
          peopleContexts.value.some(
            (person) => person.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
          ),
        )),
  ),
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
  newContextType.value = 'project'
  showContextDialog.value = false
}

async function chooseWorkspace() {
  connectionError.value = ''
  try {
    await mind.connectWorkspace()
  } catch (error) {
    if (error.name !== 'AbortError') connectionError.value = error.message
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
        <button
          v-for="context in contextIndex.slice(0, 12)"
          :key="context.name"
          class="context-link"
          :class="{ active: selectedContext?.toLocaleLowerCase() === context.name.toLocaleLowerCase() }"
          @click="openContext(context.name)"
        >
          <span>
            <b :class="`context-dot color-${context.color || 'sage'}`">{{ context.emoji || '◈' }}</b>
            @{{ context.name }}
          </span>
          <small>{{ context.count }}</small>
        </button>
      </section>

      <section v-if="tags.length" class="sidebar-section tags-section">
        <div class="section-heading"><span>ETIQUETAS</span></div>
        <button
          v-for="tag in tags.slice(0, 8)"
          :key="tag.name"
          class="tag-link"
          :class="{ active: selectedTag === tag.name }"
          @click="openTag(tag.name)"
        >
          <span>#{{ tag.name }}</span><small>{{ tag.count }}</small>
        </button>
      </section>

      <div class="sidebar-footer">
        <p class="privacy-note">Los datos permanecen en este dispositivo salvo exportación o carpeta conectada.</p>
        <div class="sync-line">
          <i :class="{ offline: !isOnline }"></i>{{ syncState }}
        </div>
        <button class="workspace-button" @click="chooseWorkspace">Conectar carpeta</button>
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
              <p class="eyebrow">TRABAJO PENDIENTE</p>
              <h1>Tareas</h1>
              <p>Todo lo accionable, sin perder el día ni el contexto donde nació.</p>
            </div>
            <div class="filter-bar">
              <button
                v-for="filter in ['open', 'today', 'completed', 'all']"
                :key="filter"
                :class="{ active: taskFilter === filter }"
                @click="taskFilter = filter"
              >{{ { open: 'Pendientes', today: 'Hoy', completed: 'Completadas', all: 'Todas' }[filter] }}</button>
              <select v-model="contextFilter">
                <option value="all">Todos los contextos</option>
                <option v-for="context in contextIndex" :key="context.name" :value="context.name">
                  @{{ context.name }}
                </option>
              </select>
              <button v-if="selectedTag" class="active" @click="selectedTag = null">
                #{{ selectedTag }} ×
              </button>
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
            <div v-else class="empty-state">No hay tareas para estos filtros. Un pequeño milagro.</div>
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
              <p>Proyectos, personas y compromisos pendientes en un único lugar.</p>
            </div>

            <section class="tracking-section">
              <div class="section-title"><h2>Esperando o delegado</h2><span>{{ waitingTasks.length }}</span></div>
              <article v-for="task in waitingTasks" :key="task.id" class="task-card compact">
                <button
                  class="task-toggle"
                  aria-label="Completar tarea"
                  :aria-pressed="false"
                  @click="mind.updateBlock(task.noteId, task.id, { checked: true })"
                ></button>
                <div @click="openTask(task)">
                  <RichText :text="task.content" @context="openContext" @tag="openTag" />
                  <small>{{ task.noteDate || task.noteTitle }}</small>
                </div>
                <button class="reminder-button" @click="editReminder(task)">◷</button>
              </article>
              <p v-if="!waitingTasks.length" class="empty-copy">
                Usa #esperando, #delegado o relaciona una tarea con una @persona.
              </p>
            </section>

            <section class="tracking-section">
              <div class="section-title"><h2>Proyectos y áreas</h2><span>{{ projectContexts.length }}</span></div>
              <div class="tracking-grid">
                <button v-for="context in projectContexts" :key="context.name" @click="openContext(context.name)">
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
                <p class="eyebrow">CONTEXTO</p>
                <h1>@{{ activeContext.name }}</h1>
                <p>{{ activeContext.count }} menciones · {{ activeContext.openTasks }} tareas abiertas</p>
                <label class="context-type-control">
                  Tipo
                  <select
                    :value="activeContext.contextType || 'project'"
                    @change="mind.updateContext(activeContext.noteId, { contextType: $event.target.value })"
                  >
                    <option v-for="(label, value) in contextTypes" :key="value" :value="value">{{ label }}</option>
                  </select>
                </label>
              </div>
            </div>

            <section v-if="contextTasks.length" class="context-section">
              <div class="section-title"><h2>Tareas abiertas</h2><span>{{ contextTasks.length }}</span></div>
              <article v-for="task in contextTasks" :key="task.id" class="task-card compact">
                <button
                  class="task-toggle"
                  aria-label="Completar tarea"
                  :aria-pressed="false"
                  @click="mind.updateBlock(task.noteId, task.id, { checked: true })"
                ></button>
                <div @click="openTask(task)">
                  <RichText :text="task.content" @context="openContext" @tag="openTag" />
                  <small>{{ task.noteDate }}</small>
                </div>
                <button class="reminder-button" @click="editReminder(task)">◷</button>
              </article>
            </section>

            <section class="context-section">
              <div class="section-title"><h2>Actividad reciente</h2><span>{{ activeContextBlocks.length }}</span></div>
              <div class="activity-timeline">
                <article v-for="block in activeContextBlocks" :key="block.id" @click="openTask(block)">
                  <time>{{ block.noteDate || block.noteTitle }}</time>
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
      <button :class="{ active: currentView === 'tasks' }" @click="navigate('tasks')"><span>✓</span>Tareas</button>
      <button @click="openSearch"><span>⌕</span>Buscar</button>
      <button :class="{ active: currentView === 'agenda' }" @click="navigate('agenda')"><span>◷</span>Agenda</button>
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
        <p class="eyebrow">NUEVO CONTEXTO</p>
        <h2>Crea un lugar para reunir trabajo</h2>
        <input v-model="newContextName" autofocus placeholder="motor, hogar, Sara…" />
        <label>
          Tipo de contexto
          <select v-model="newContextType">
            <option v-for="(label, value) in contextTypes" :key="value" :value="value">{{ label }}</option>
          </select>
        </label>
        <div>
          <button type="button" class="secondary-button" @click="showContextDialog = false">Cancelar</button>
          <button class="primary-button">Crear @contexto</button>
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
