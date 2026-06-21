<script setup>
import { computed, nextTick, ref } from 'vue'
import { extractContexts, extractTags } from '../lib/markdown'

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
const inputRefs = new Map()

const contextNames = computed(() => props.contexts.map((item) => item.name))
const tagNames = computed(() => props.tags.map((item) => item.name))

function registerInput(id, element) {
  if (element) inputRefs.set(id, element)
  else inputRefs.delete(id)
}

function resize(event) {
  event.target.style.height = 'auto'
  event.target.style.height = `${event.target.scrollHeight}px`
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
    const newBlock = emit('add-block', block.id, type)
    nextTick(() => {
      const next = props.note.blocks[index + 1]
      if (next) inputRefs.get(next.id)?.focus()
    })
    return newBlock
  }
  if (event.key === 'Backspace' && !block.content && index > 0) {
    event.preventDefault()
    const previous = props.note.blocks[index - 1]
    emit('remove-block', block.id)
    nextTick(() => inputRefs.get(previous.id)?.focus())
  }
}

function contextChips(block) {
  return extractContexts(block.content)
}

function tagChips(block) {
  return extractTags(block.content)
}
</script>

<template>
  <div class="block-editor">
    <div
      v-for="(block, index) in note.blocks"
      :key="block.id"
      :data-block-id="block.id"
      class="block-row"
      :class="[`block-${block.type}`, { completed: block.checked }]"
    >
      <div class="block-gutter">
        <button
          v-if="block.type === 'task'"
          class="task-toggle"
          :aria-label="block.checked ? 'Marcar como pendiente' : 'Completar tarea'"
          @click="emit('update-block', block.id, { checked: !block.checked })"
        >{{ block.checked ? '✓' : '' }}</button>
        <span v-else-if="block.type === 'log'" class="block-bullet">•</span>
        <button v-else class="block-handle" title="Cambiar tipo">⋮</button>
      </div>

      <div class="block-main">
        <textarea
          :ref="(element) => registerInput(block.id, element)"
          class="block-input"
          :class="{ 'title-block': block.type === 'heading' && block.level === 1 }"
          :value="block.content"
          rows="1"
          :placeholder="block.type === 'heading' ? 'Encabezado' : block.type === 'task' ? 'Nueva tarea…' : 'Escribe algo…'"
          @focus="resize"
          @input="handleInput(block, $event)"
          @keydown="handleKeydown(block, index, $event)"
        ></textarea>

        <div v-if="block.reminder || contextChips(block).length || tagChips(block).length" class="block-metadata">
          <button
            v-for="context in contextChips(block)"
            :key="context"
            class="metadata-context"
            @click="emit('open-context', context)"
          >@{{ context }}</button>
          <button
            v-for="tag in tagChips(block)"
            :key="tag"
            class="metadata-tag"
            @click="emit('open-tag', tag)"
          >#{{ tag }}</button>
          <span v-if="block.reminder" class="metadata-reminder">
            ◷ {{ new Date(block.reminder).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) }}
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
      </div>

      <div class="block-actions">
        <button
          v-if="block.type === 'task'"
          title="Añadir recordatorio"
          @click="emit('edit-reminder', block)"
        >◷</button>
        <select
          :value="block.type"
          aria-label="Tipo de bloque"
          @change="emit('change-type', block.id, $event.target.value)"
        >
          <option value="log">Log</option>
          <option value="text">Texto</option>
          <option value="task">Tarea</option>
          <option value="heading">Título</option>
        </select>
        <button
          v-if="block.type !== 'heading' || block.level !== 1"
          title="Eliminar bloque"
          @click="emit('remove-block', block.id)"
        >×</button>
      </div>
    </div>
  </div>
</template>
