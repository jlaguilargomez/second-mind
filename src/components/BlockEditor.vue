<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import RichText from './RichText.vue'
import { formatReminderDate } from '../lib/markdown'
import {
  blockActionShortcutLabels,
  getBlockActionShortcut,
  getCaptureShortcut,
} from '../lib/editorShortcuts'

const props = defineProps({
  note: { type: Object, required: true },
  contexts: { type: Array, default: () => [] },
  tags: { type: Array, default: () => [] },
  readOnly: { type: Boolean, default: false },
})

const emit = defineEmits([
  'update-block',
  'add-block',
  'remove-block',
  'change-type',
  'edit-reminder',
  'open-context',
  'open-tag',
])

const activeSuggestion = ref(null)
const focusedBlockId = ref(null)
const activeSuggestionIndex = ref(0)
const openBlockMenuId = ref(null)
const inputRefs = new Map()
const menuRefs = new Map()

const contextNames = computed(() => props.contexts.map((item) => item.name))
const tagNames = computed(() => props.tags.map((item) => item.name))
const blockTypeDefinitions = {
  log: { label: 'Entrada', icon: '•' },
  text: { label: 'Párrafo', icon: '¶' },
  task: { label: 'Tarea', icon: '○' },
  heading: { label: 'Título', icon: 'H' },
}
const blockTypes = [
  { value: 'log', shortcut: '- espacio', ...blockTypeDefinitions.log },
  { value: 'task', shortcut: '+ espacio', ...blockTypeDefinitions.task },
]
const indentableTypes = new Set(['log', 'task'])
const priorityOptions = {
  base: { label: 'Base', icon: '–' },
  medium: { label: 'Media', icon: '↑' },
  high: { label: 'Alta', icon: '↑↑' },
}

function registerInput(id, element) {
  if (element) inputRefs.set(id, element)
  else inputRefs.delete(id)
}

function registerMenu(id, element) {
  if (element) menuRefs.set(id, element)
  else menuRefs.delete(id)
}

function resize(event) {
  event.target.style.height = 'auto'
  event.target.style.height = `${event.target.scrollHeight}px`
}

function focusBlock(blockId) {
  if (props.readOnly) return
  if (focusedBlockId.value !== blockId) openBlockMenuId.value = null
  focusedBlockId.value = blockId
  nextTick(() => {
    const input = inputRefs.get(blockId)
    input?.focus()
    if (input) {
      input.selectionStart = input.value.length
      input.selectionEnd = input.value.length
      input.style.height = 'auto'
      input.style.height = `${input.scrollHeight}px`
    }
  })
}

function handleBlur(blockId) {
  window.setTimeout(() => {
    if (activeSuggestion.value?.blockId === blockId) return
    if (openBlockMenuId.value === blockId) return
    if (focusedBlockId.value === blockId) focusedBlockId.value = null
  }, 100)
}

function handleInput(block, event) {
  if (props.readOnly) return
  resize(event)
  const value = event.target.value
  emit('update-block', block.id, { content: value })
  const cursor = event.target.selectionStart
  const fragment = value.slice(0, cursor).match(/(?:^|\s)([@#])([\p{L}\p{N}_/-]*)$/u)
  if (!fragment) {
    activeSuggestion.value = null
    return
  }
  const type = fragment[1] === '@' ? 'context' : 'tag'
  const query = fragment[2].toLocaleLowerCase()
  const source = type === 'context' ? contextNames.value : tagNames.value
  activeSuggestion.value = {
    blockId: block.id,
    type,
    query: fragment[2],
    start: cursor - fragment[2].length - 1,
    end: cursor,
    options: source
      .filter((name) => name.toLocaleLowerCase().includes(query))
      .slice(0, 6),
  }
  activeSuggestionIndex.value = 0
}

function addBlockAfter(blockId, type = 'log', content = '', options = {}) {
  if (props.readOnly) return
  const existingIds = new Set(props.note.blocks.map((block) => block.id))
  emit('add-block', blockId, type, content, options)
  nextTick(() => {
    const newBlock = props.note.blocks.find((block) => !existingIds.has(block.id))
    if (newBlock) focusBlock(newBlock.id)
  })
}

function changeType(block, type) {
  if (props.readOnly) return
  emit('change-type', block.id, type)
  openBlockMenuId.value = null
  focusBlock(block.id)
}

function applyBlockShortcut(block, shortcut) {
  if (props.readOnly) return
  emit('change-type', block.id, shortcut.type)
  emit('update-block', block.id, {
    content: shortcut.content,
    ...shortcut.patch,
  })
  openBlockMenuId.value = null
  activeSuggestion.value = null
  nextTick(() => {
    const input = inputRefs.get(block.id)
    input?.focus()
    if (input) input.setSelectionRange(0, 0)
  })
}

function cyclePriority(block) {
  if (props.readOnly) return
  const priorities = ['base', 'medium', 'high']
  const currentIndex = priorities.indexOf(block.priority || 'base')
  emit('update-block', block.id, {
    priority: priorities[(currentIndex + 1) % priorities.length],
  })
  openBlockMenuId.value = null
  focusBlock(block.id)
}

function changeIndent(block, index, direction) {
  if (props.readOnly) return
  if (!indentableTypes.has(block.type)) return
  const currentIndent = block.indent || 0
  if (direction < 0) {
    emit('update-block', block.id, { indent: Math.max(currentIndent - 1, 0) })
    openBlockMenuId.value = null
    focusBlock(block.id)
    return
  }
  const previous = props.note.blocks[index - 1]
  if (!previous || !indentableTypes.has(previous.type)) return
  const maximumIndent = Math.min((previous.indent || 0) + 1, 6)
  emit('update-block', block.id, {
    indent: Math.min(currentIndent + 1, maximumIndent),
  })
  openBlockMenuId.value = null
  focusBlock(block.id)
}

function toggleBlockMenu(blockId, focusFirstAction = false) {
  if (props.readOnly) return
  openBlockMenuId.value = openBlockMenuId.value === blockId ? null : blockId
  if (!openBlockMenuId.value || !focusFirstAction) return
  nextTick(() => menuRefs.get(blockId)?.querySelector('button:not(:disabled)')?.focus())
}

function closeBlockMenu(blockId, restoreFocus = false) {
  if (openBlockMenuId.value === blockId) openBlockMenuId.value = null
  if (restoreFocus) focusBlock(blockId)
}

function applySuggestion(block, option) {
  if (props.readOnly) return
  const marker = activeSuggestion.value.type === 'context' ? '@' : '#'
  const insertion = `${marker}${option} `
  const content =
    block.content.slice(0, activeSuggestion.value.start) +
    insertion +
    block.content.slice(activeSuggestion.value.end)
  const cursor = activeSuggestion.value.start + insertion.length
  emit('update-block', block.id, { content })
  activeSuggestion.value = null
  nextTick(() => {
    const input = inputRefs.get(block.id)
    input?.focus()
    if (input) input.setSelectionRange(cursor, cursor)
  })
}

function handleKeydown(block, index, event) {
  if (props.readOnly) return
  const suggestion = activeSuggestion.value?.blockId === block.id
    ? activeSuggestion.value
    : null
  const shortcut = getCaptureShortcut({
    key: event.key,
    value: event.target.value,
    selectionStart: event.target.selectionStart,
    selectionEnd: event.target.selectionEnd,
    hasSuggestion: Boolean(suggestion),
  })
  const actionShortcut = getBlockActionShortcut({
    key: event.key,
    code: event.code,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    blockType: block.type,
  })

  if (suggestion && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
    event.preventDefault()
    const optionCount = suggestion.options.length
    if (!optionCount) return
    const direction = event.key === 'ArrowDown' ? 1 : -1
    activeSuggestionIndex.value =
      (activeSuggestionIndex.value + direction + optionCount) % optionCount
    return
  }
  if (suggestion && ['Enter', 'Tab'].includes(event.key)) {
    const option =
      suggestion.options[activeSuggestionIndex.value] ||
      (suggestion.type === 'context' && suggestion.query ? suggestion.query : null)
    if (option) {
      event.preventDefault()
      applySuggestion(block, option)
      return
    }
  }
  if (event.key === 'Escape') {
    activeSuggestion.value = null
    openBlockMenuId.value = null
    return
  }
  if (actionShortcut) {
    event.preventDefault()
    activeSuggestion.value = null
    if (actionShortcut === 'toggle-menu') toggleBlockMenu(block.id, true)
    if (actionShortcut === 'edit-reminder') openReminder(block)
    if (actionShortcut === 'cycle-priority') cyclePriority(block)
    if (actionShortcut === 'remove-block') removeBlock(block.id)
    return
  }
  if (shortcut) {
    event.preventDefault()
    applyBlockShortcut(block, shortcut)
    return
  }
  if (event.key === 'Tab' && indentableTypes.has(block.type)) {
    event.preventDefault()
    activeSuggestion.value = null
    changeIndent(block, index, event.shiftKey ? -1 : 1)
    focusBlock(block.id)
    return
  }
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    activeSuggestion.value = null
    const type = block.type === 'heading' ? 'log' : block.type
    const start = event.target.selectionStart
    const end = event.target.selectionEnd
    const before = block.content.slice(0, start)
    const after = block.content.slice(end)
    emit('update-block', block.id, { content: before })
    addBlockAfter(block.id, type, after, { indent: block.indent || 0 })
    return
  }
  if (event.key === 'Backspace' && !block.content && index > 0) {
    event.preventDefault()
    if (block.indent > 0) {
      changeIndent(block, index, -1)
      focusBlock(block.id)
      return
    }
    const previous = props.note.blocks[index - 1]
    emit('remove-block', block.id)
    focusBlock(previous.id)
  }
}

function removeBlock(blockId) {
  if (props.readOnly) return
  openBlockMenuId.value = null
  emit('remove-block', blockId)
}

function openReminder(block) {
  if (props.readOnly) return
  openBlockMenuId.value = null
  emit('edit-reminder', block)
}

function toggleTask(block) {
  if (props.readOnly) return
  emit('update-block', block.id, { checked: !block.checked })
}

function handlePointerDown(event) {
  if (!openBlockMenuId.value) return
  if (event.target.closest('[data-block-menu]')) return
  openBlockMenuId.value = null
}

watch(
  () => props.readOnly,
  (readOnly) => {
    if (!readOnly) return
    activeSuggestion.value = null
    focusedBlockId.value = null
    openBlockMenuId.value = null
  },
)

onMounted(() => {
  window.addEventListener('pointerdown', handlePointerDown)
})

onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', handlePointerDown)
})

</script>

<template>
  <div class="block-editor" :class="{ 'read-only': readOnly }">
    <div
      v-for="(block, index) in note.blocks"
      :key="block.id"
      :data-block-id="block.id"
      class="block-row"
      :style="{ '--indent-level': Math.min(block.indent || 0, 6) }"
      :class="[
        `block-${block.type}`,
        {
          completed: block.checked,
          'document-title-row': block.type === 'heading' && block.level === 1,
          'section-child': block.type !== 'heading' && block.inheritedContexts?.length,
          'nested-block': indentableTypes.has(block.type) && block.indent > 0,
        },
      ]"
    >
      <div class="block-gutter">
        <button
          v-if="block.type === 'task'"
          class="task-toggle"
          :disabled="readOnly"
          :title="readOnly ? 'Documento bloqueado' : undefined"
          :aria-label="block.checked ? 'Marcar como pendiente' : 'Completar tarea'"
          :aria-pressed="block.checked"
          @click="toggleTask(block)"
        >{{ block.checked ? '✓' : '' }}</button>
        <button
          v-else
          class="block-kind-button"
          :disabled="readOnly"
          :title="readOnly ? 'Documento bloqueado' : `Editar ${blockTypeDefinitions[block.type]?.label || 'bloque'}`"
          @click="focusBlock(block.id)"
        >
          {{ blockTypeDefinitions[block.type]?.icon || '•' }}
        </button>
      </div>

      <div class="block-main">
        <div
          v-show="readOnly || focusedBlockId !== block.id"
          class="block-rendered"
          :class="{
            'title-block': block.type === 'heading' && block.level === 1,
            placeholder: !block.content,
          }"
          :role="readOnly ? undefined : 'textbox'"
          :tabindex="readOnly ? undefined : 0"
          :aria-label="readOnly ? undefined : block.content || 'Bloque vacío. Pulsa para editar'"
          @click="focusBlock(block.id)"
          @keydown.enter.prevent="focusBlock(block.id)"
        >
          <RichText
            v-if="block.content"
            :text="block.content"
            @context="emit('open-context', $event)"
            @tag="emit('open-tag', $event)"
          />
          <span v-else>{{ readOnly ? 'Sin contenido' : block.type === 'task' ? 'Nueva tarea…' : 'Escribe algo…' }}</span>
        </div>

        <textarea
          v-show="!readOnly && focusedBlockId === block.id"
          :ref="(element) => registerInput(block.id, element)"
          class="block-input"
          :class="{ 'title-block': block.type === 'heading' && block.level === 1 }"
          :value="block.content"
          :readonly="readOnly"
          rows="1"
          :placeholder="block.type === 'heading' ? 'Encabezado' : block.type === 'task' ? 'Nueva tarea…' : 'Escribe algo…'"
          @focus="focusedBlockId = block.id; resize($event)"
          @blur="handleBlur(block.id)"
          @input="handleInput(block, $event)"
          @keydown="handleKeydown(block, index, $event)"
        ></textarea>

        <div
          v-if="block.reminder || (block.type === 'task' && block.priority !== 'base')"
          class="block-metadata"
        >
          <span
            v-if="block.type === 'task' && block.priority !== 'base'"
            class="priority-badge"
            :class="`priority-${block.priority}`"
          >
            {{ priorityOptions[block.priority]?.icon }}
            {{ priorityOptions[block.priority]?.label }}
          </span>
          <span v-if="block.reminder" class="metadata-reminder">
            ◷ {{ formatReminderDate(block.reminder) }}
          </span>
        </div>

        <div
          v-if="!readOnly && activeSuggestion?.blockId === block.id"
          class="suggestion-menu"
        >
          <button
            v-for="(option, optionIndex) in activeSuggestion.options"
            :key="option"
            :class="{ active: optionIndex === activeSuggestionIndex }"
            @mousedown.prevent="applySuggestion(block, option)"
          >
            <span>{{ activeSuggestion.type === 'context' ? '@' : '#' }}</span>{{ option }}
          </button>
          <button
            v-if="activeSuggestion.type === 'context' && activeSuggestion.query && !activeSuggestion.options.length"
            @mousedown.prevent="applySuggestion(block, activeSuggestion.query)"
          >
            <span>＋</span>Crear @{{ activeSuggestion.query }}
          </button>
        </div>

        <div
          v-if="!readOnly && focusedBlockId === block.id"
          class="block-menu-anchor"
          data-block-menu
        >
          <button
            class="block-menu-trigger"
            :aria-expanded="openBlockMenuId === block.id"
            :aria-controls="`block-menu-${block.id}`"
            aria-label="Mostrar opciones del bloque"
            aria-keyshortcuts="Control+. Meta+."
            :title="`Opciones (${blockActionShortcutLabels.menu})`"
            @mousedown.prevent
            @click="toggleBlockMenu(block.id)"
          >
            <span aria-hidden="true">⋯</span>
            <span class="block-menu-trigger-label">Opciones</span>
          </button>

          <div
            v-if="openBlockMenuId === block.id"
            :id="`block-menu-${block.id}`"
            :ref="(element) => registerMenu(block.id, element)"
            class="block-menu-panel"
            aria-label="Opciones del bloque"
            @keydown.esc.stop.prevent="closeBlockMenu(block.id, true)"
          >
            <span class="toolbar-label">Tipo</span>
            <div class="block-menu-group" role="group" aria-label="Tipo de entrada">
              <button
                v-for="type in blockTypes"
                :key="type.value"
                :class="{ active: block.type === type.value }"
                :aria-pressed="block.type === type.value"
                :title="`Convertir en ${type.label.toLocaleLowerCase()} (${type.shortcut})`"
                @click="changeType(block, type.value)"
              >
                <span aria-hidden="true">{{ type.icon }}</span>
                <span>{{ type.label }}</span>
                <kbd>{{ type.shortcut }}</kbd>
              </button>
            </div>

            <div class="block-menu-group block-menu-actions">
              <button
                v-if="indentableTypes.has(block.type)"
                :disabled="!block.indent"
                title="Reducir nivel (Shift + Tab)"
                aria-keyshortcuts="Shift+Tab"
                @click="changeIndent(block, index, -1)"
              >
                <span aria-hidden="true">←</span><span>Reducir nivel</span><kbd>Shift Tab</kbd>
              </button>
              <button
                v-if="indentableTypes.has(block.type)"
                title="Crear subitem (Tab)"
                aria-keyshortcuts="Tab"
                @click="changeIndent(block, index, 1)"
              >
                <span aria-hidden="true">→</span><span>Subitem</span><kbd>Tab</kbd>
              </button>
              <button
                v-if="block.type === 'task'"
                class="priority-control"
                :class="`priority-${block.priority || 'base'}`"
                :title="`Prioridad ${priorityOptions[block.priority || 'base'].label} (${blockActionShortcutLabels.priority})`"
                :aria-label="`Prioridad: ${priorityOptions[block.priority || 'base'].label}. Cambiar prioridad`"
                aria-keyshortcuts="Control+Shift+P Meta+Shift+P"
                @click="cyclePriority(block)"
              >
                <span aria-hidden="true">{{ priorityOptions[block.priority || 'base'].icon }}</span>
                <span>Prioridad {{ priorityOptions[block.priority || 'base'].label }}</span>
                <kbd>Ctrl/⌘ ⇧ P</kbd>
              </button>
              <button
                v-if="block.type === 'task'"
                :title="`Añadir fecha (${blockActionShortcutLabels.reminder})`"
                aria-keyshortcuts="Control+; Meta+;"
                @click="openReminder(block)"
              >
                <span aria-hidden="true">◷</span><span>Fecha</span><kbd>Ctrl/⌘ ;</kbd>
              </button>
            </div>

            <div
              v-if="block.type !== 'heading' || block.level !== 1"
              class="block-menu-group block-menu-danger"
            >
              <button
                class="remove-block-button"
                :title="`Eliminar entrada (${blockActionShortcutLabels.remove})`"
                aria-keyshortcuts="Control+Shift+Backspace Meta+Shift+Backspace"
                @click="removeBlock(block.id)"
              >
                <span aria-hidden="true">×</span><span>Eliminar</span><kbd>Ctrl/⌘ ⇧ ⌫</kbd>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <button
      v-if="!readOnly"
      class="add-entry-button"
      @click="addBlockAfter(note.blocks.at(-1)?.id)"
    >
      <span>＋</span>
      <strong>Añadir entrada</strong>
      <small>Intro para seguir · + tarea · - entrada</small>
    </button>
  </div>
</template>
