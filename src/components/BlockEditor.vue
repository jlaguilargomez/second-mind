<script setup>
import { computed, nextTick, ref } from 'vue'
import RichText from './RichText.vue'
import { formatReminderDate } from '../lib/markdown'

const props = defineProps({
  note: { type: Object, required: true },
  contexts: { type: Array, default: () => [] },
  tags: { type: Array, default: () => [] },
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
const inputRefs = new Map()

const contextNames = computed(() => props.contexts.map((item) => item.name))
const tagNames = computed(() => props.tags.map((item) => item.name))
const blockTypes = [
  { value: 'log', label: 'Log', icon: '•' },
  { value: 'text', label: 'Texto', icon: '¶' },
  { value: 'task', label: 'Tarea', icon: '○' },
  { value: 'heading', label: 'Título', icon: 'H' },
]

function registerInput(id, element) {
  if (element) inputRefs.set(id, element)
  else inputRefs.delete(id)
}

function resize(event) {
  event.target.style.height = 'auto'
  event.target.style.height = `${event.target.scrollHeight}px`
}

function focusBlock(blockId) {
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
    focusedBlockId.value = null
  }, 100)
}

function handleInput(block, event) {
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
    options: source
      .filter((name) => name.toLocaleLowerCase().includes(query))
      .slice(0, 6),
  }
}

function addBlockAfter(blockId, type = 'log') {
  const existingIds = new Set(props.note.blocks.map((block) => block.id))
  emit('add-block', blockId, type)
  nextTick(() => {
    const newBlock = props.note.blocks.find((block) => !existingIds.has(block.id))
    if (newBlock) focusBlock(newBlock.id)
  })
}

function changeType(block, type) {
  emit('change-type', block.id, type)
  focusBlock(block.id)
}

function applySuggestion(block, option) {
  const marker = activeSuggestion.value.type === 'context' ? '@' : '#'
  const pattern = new RegExp(`${marker}${activeSuggestion.value.query}$`)
  const content = block.content.replace(pattern, `${marker}${option} `)
  emit('update-block', block.id, { content })
  activeSuggestion.value = null
  nextTick(() => inputRefs.get(block.id)?.focus())
}

function handleKeydown(block, index, event) {
  if (event.key === 'Escape') {
    activeSuggestion.value = null
    return
  }
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    activeSuggestion.value = null
    const type = block.type === 'heading' ? 'log' : block.type
    addBlockAfter(block.id, type)
    return
  }
  if (event.key === 'Backspace' && !block.content && index > 0) {
    event.preventDefault()
    const previous = props.note.blocks[index - 1]
    emit('remove-block', block.id)
    nextTick(() => inputRefs.get(previous.id)?.focus())
  }
}

</script>

<template>
  <div class="block-editor">
    <div
      v-for="(block, index) in note.blocks"
      :key="block.id"
      :data-block-id="block.id"
      class="block-row"
      :class="[
        `block-${block.type}`,
        {
          completed: block.checked,
          'document-title-row': block.type === 'heading' && block.level === 1,
        },
      ]"
    >
      <div class="block-gutter">
        <button
          v-if="block.type === 'task'"
          class="task-toggle"
          :aria-label="block.checked ? 'Marcar como pendiente' : 'Completar tarea'"
          @click="emit('update-block', block.id, { checked: !block.checked })"
        >{{ block.checked ? '✓' : '' }}</button>
        <button
          v-else
          class="block-kind-button"
          :title="`Editar ${blockTypes.find((type) => type.value === block.type)?.label || 'bloque'}`"
          @click="focusBlock(block.id)"
        >
          {{ blockTypes.find((type) => type.value === block.type)?.icon || '•' }}
        </button>
      </div>

      <div class="block-main">
        <div
          v-show="focusedBlockId !== block.id"
          class="block-rendered"
          :class="{
            'title-block': block.type === 'heading' && block.level === 1,
            placeholder: !block.content,
          }"
          role="textbox"
          tabindex="0"
          :aria-label="block.content || 'Bloque vacío. Pulsa para editar'"
          @click="focusBlock(block.id)"
          @keydown.enter.prevent="focusBlock(block.id)"
        >
          <RichText
            v-if="block.content"
            :text="block.content"
            @context="emit('open-context', $event)"
            @tag="emit('open-tag', $event)"
          />
          <span v-else>{{ block.type === 'task' ? 'Nueva tarea…' : 'Escribe algo…' }}</span>
        </div>

        <textarea
          v-show="focusedBlockId === block.id"
          :ref="(element) => registerInput(block.id, element)"
          class="block-input"
          :class="{ 'title-block': block.type === 'heading' && block.level === 1 }"
          :value="block.content"
          rows="1"
          :placeholder="block.type === 'heading' ? 'Encabezado' : block.type === 'task' ? 'Nueva tarea…' : 'Escribe algo…'"
          @focus="focusedBlockId = block.id; resize($event)"
          @blur="handleBlur(block.id)"
          @input="handleInput(block, $event)"
          @keydown="handleKeydown(block, index, $event)"
        ></textarea>

        <div v-if="block.reminder" class="block-metadata">
          <span v-if="block.reminder" class="metadata-reminder">
            ◷ {{ formatReminderDate(block.reminder) }}
          </span>
        </div>

        <div
          v-if="activeSuggestion?.blockId === block.id"
          class="suggestion-menu"
        >
          <button
            v-for="option in activeSuggestion.options"
            :key="option"
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

        <div v-if="focusedBlockId === block.id" class="block-toolbar" @mousedown.prevent>
          <span class="toolbar-label">Tipo</span>
          <div class="type-options" role="group" aria-label="Tipo de entrada">
            <button
              v-for="type in blockTypes"
              :key="type.value"
              :class="{ active: block.type === type.value }"
              :aria-pressed="block.type === type.value"
              :title="`Convertir en ${type.label.toLocaleLowerCase()}`"
              @click="changeType(block, type.value)"
            >
              <span>{{ type.icon }}</span>{{ type.label }}
            </button>
          </div>
          <div class="toolbar-actions">
            <button
              v-if="block.type === 'task'"
              title="Añadir recordatorio"
              @click="emit('edit-reminder', block)"
            >◷ <span>Fecha</span></button>
            <button
              v-if="block.type !== 'heading' || block.level !== 1"
              class="remove-block-button"
              title="Eliminar entrada"
              @click="emit('remove-block', block.id)"
            >× <span>Eliminar</span></button>
          </div>
        </div>
      </div>
    </div>

    <button
      class="add-entry-button"
      @click="addBlockAfter(note.blocks.at(-1)?.id, 'log')"
    >
      <span>＋</span>
      <strong>Añadir entrada</strong>
      <small>o pulsa Intro al escribir</small>
    </button>
  </div>
</template>
