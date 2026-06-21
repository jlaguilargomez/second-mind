<script setup>
import { computed, nextTick, onMounted, ref } from 'vue'
import { useNotes } from './composables/useNotes'

const {
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
} = useNotes()

const search = ref('')
const showSearch = ref(false)
const showContextDialog = ref(false)
const newContext = ref('')
const importInput = ref(null)
const editor = ref(null)
const connectionError = ref('')

const visibleJournals = computed(() => journals.value.slice(0, 12))
const relatedNotes = computed(() => {
  if (!activeNote.value || activeNote.value.kind !== 'context') return []
  const name = activeNote.value.title.toLocaleLowerCase()
  return journals.value.filter((note) =>
    note.contexts.some((context) => context.toLocaleLowerCase() === name),
  )
})
const searchResults = computed(() => {
  const term = search.value.trim().toLocaleLowerCase()
  if (!term) return []
  return notes.value
    .filter((note) => `${note.title} ${note.markdown}`.toLocaleLowerCase().includes(term))
    .slice(0, 12)
})

function selectNote(id) {
  activeId.value = id
  showSearch.value = false
  nextTick(() => editor.value?.focus())
}

async function chooseWorkspace() {
  connectionError.value = ''
  try {
    await connectWorkspace()
  } catch (error) {
    if (error.name !== 'AbortError') connectionError.value = error.message
  }
}

async function createContext() {
  const name = newContext.value.trim()
  if (!name) return
  await openContext(name)
  newContext.value = ''
  showContextDialog.value = false
}

function handleShortcuts(event) {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    showSearch.value = true
    nextTick(() => document.querySelector('.search-input')?.focus())
  }
}

onMounted(() => {
  restoreWorkspace()
  window.addEventListener('keydown', handleShortcuts)
})
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-mark">S</div>
        <div>
          <strong>Second Mind</strong>
          <span>{{ workspaceName }}</span>
        </div>
        <button class="icon-button mobile-only" aria-label="Cerrar menú">×</button>
      </div>

      <button class="today-button" @click="openToday">
        <span class="today-icon">◉</span>
        Ir a hoy
        <kbd>⌘ J</kbd>
      </button>

      <nav>
        <button class="nav-item" @click="showSearch = true">
          <span>⌕</span> Buscar <kbd>⌘ K</kbd>
        </button>
        <button class="nav-item" @click="importInput?.click()">
          <span>↥</span> Importar Markdown
        </button>
        <input
          ref="importInput"
          class="visually-hidden"
          type="file"
          accept=".md,text/markdown"
          multiple
          @change="importFiles($event.target.files)"
        />
      </nav>

      <section class="sidebar-section">
        <div class="section-heading">
          <span>DIARIO</span>
        </div>
        <button
          v-for="note in visibleJournals"
          :key="note.id"
          class="note-link"
          :class="{ active: activeId === note.id }"
          @click="selectNote(note.id)"
        >
          <span>{{ note.date || note.title }}</span>
          <small>{{ note.excerpt || 'Nota vacía' }}</small>
        </button>
      </section>

      <section class="sidebar-section contexts-section">
        <div class="section-heading">
          <span>CONTEXTOS</span>
          <button aria-label="Nuevo contexto" @click="showContextDialog = true">＋</button>
        </div>
        <button
          v-for="context in contextIndex.slice(0, 10)"
          :key="context.name"
          class="context-link"
          @click="openContext(context.name)"
        >
          <span><i></i>{{ context.name }}</span>
          <small>{{ context.count }}</small>
        </button>
      </section>

      <div class="sidebar-footer">
        <div class="sync-line"><i></i>{{ syncState }}</div>
        <button class="workspace-button" @click="chooseWorkspace">Abrir carpeta Markdown</button>
        <p v-if="connectionError" class="error">{{ connectionError }}</p>
      </div>
    </aside>

    <main class="workspace">
      <header class="topbar">
        <div class="breadcrumbs">
          <span>{{ activeNote?.kind === 'context' ? 'Contextos' : 'Diario' }}</span>
          <b>/</b>
          <strong>{{ activeNote?.date || activeNote?.title }}</strong>
        </div>
        <div class="top-actions">
          <span class="save-state">{{ syncState }}</span>
          <button class="icon-button" title="Descargar Markdown" @click="downloadActive">↓</button>
          <button class="primary-button" @click="chooseWorkspace">Conectar carpeta</button>
        </div>
      </header>

      <div v-if="activeNote" class="editor-layout">
        <article class="editor-column">
          <div class="note-meta">
            <span class="kind-pill">{{ activeNote.kind === 'context' ? 'CONTEXTO' : 'DIARIO' }}</span>
            <span>{{ activeNote.filename }}</span>
          </div>
          <textarea
            ref="editor"
            class="markdown-editor"
            :value="activeNote.markdown"
            spellcheck="true"
            aria-label="Editor Markdown"
            @input="updateActive($event.target.value)"
          ></textarea>
          <div class="editor-hint">
            <span>Markdown</span>
            <span>Usa <code>[[Contexto]]</code> o <code>#etiqueta</code> para conectar ideas</span>
          </div>
        </article>

        <aside class="inspector">
          <section>
            <p class="eyebrow">EN ESTA NOTA</p>
            <h3>Contextos</h3>
            <div v-if="activeNote.contexts.length" class="context-pills">
              <button
                v-for="context in activeNote.contexts"
                :key="context"
                @click="openContext(context)"
              >
                {{ context }}
              </button>
            </div>
            <p v-else class="empty-copy">Añade un enlace o etiqueta para empezar a conectar esta nota.</p>
          </section>

          <section v-if="activeNote.kind === 'context'">
            <p class="eyebrow">MENCIONES</p>
            <h3>{{ relatedNotes.length }} notas relacionadas</h3>
            <button
              v-for="note in relatedNotes"
              :key="note.id"
              class="backlink"
              @click="selectNote(note.id)"
            >
              <strong>{{ note.date || note.title }}</strong>
              <span>{{ note.excerpt }}</span>
            </button>
          </section>

          <section class="file-info">
            <p class="eyebrow">ARCHIVO</p>
            <dl>
              <div><dt>Formato</dt><dd>Markdown</dd></div>
              <div><dt>Ruta</dt><dd>{{ activeNote.kind === 'context' ? 'contexts' : 'journals' }}/</dd></div>
            </dl>
          </section>
        </aside>
      </div>
    </main>

    <div v-if="showSearch" class="modal-backdrop" @click.self="showSearch = false">
      <div class="search-modal">
        <div class="search-box">
          <span>⌕</span>
          <input
            v-model="search"
            class="search-input"
            placeholder="Busca en todas tus notas…"
            @keydown.esc="showSearch = false"
          />
          <kbd>ESC</kbd>
        </div>
        <div class="search-results">
          <p v-if="!search" class="search-prompt">Busca por texto, contexto o fecha.</p>
          <button
            v-for="note in searchResults"
            :key="note.id"
            @click="selectNote(note.id)"
          >
            <span class="result-icon">{{ note.kind === 'context' ? '◇' : '◷' }}</span>
            <span><strong>{{ note.date || note.title }}</strong><small>{{ note.excerpt }}</small></span>
          </button>
          <p v-if="search && !searchResults.length" class="search-prompt">No hay resultados.</p>
        </div>
      </div>
    </div>

    <div v-if="showContextDialog" class="modal-backdrop" @click.self="showContextDialog = false">
      <form class="small-modal" @submit.prevent="createContext">
        <p class="eyebrow">NUEVO CONTEXTO</p>
        <h2>Agrupa ideas relacionadas</h2>
        <input v-model="newContext" autofocus placeholder="Ej. Lanzamiento, Clientes, Ideas…" />
        <div>
          <button type="button" class="secondary-button" @click="showContextDialog = false">Cancelar</button>
          <button class="primary-button">Crear contexto</button>
        </div>
      </form>
    </div>
  </div>
</template>
