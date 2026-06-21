<script setup>
import { ref, watch } from 'vue'

const props = defineProps({
  block: { type: Object, default: null },
})
const emit = defineEmits(['close', 'save'])
const value = ref('')

function toLocalInput(dateValue) {
  if (!dateValue) return ''
  const date = new Date(dateValue)
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

watch(
  () => props.block,
  (block) => {
    value.value = toLocalInput(block?.reminder)
  },
  { immediate: true },
)
</script>

<template>
  <div v-if="block" class="modal-backdrop" @click.self="emit('close')">
    <form class="small-modal reminder-modal" @submit.prevent="emit('save', value)">
      <p class="eyebrow">RECORDATORIO</p>
      <h2>{{ block.content || 'Bloque sin título' }}</h2>
      <label>
        Fecha y hora
        <input v-model="value" type="datetime-local" required />
      </label>
      <div>
        <button
          v-if="block.reminder"
          type="button"
          class="danger-button"
          @click="emit('save', null)"
        >Eliminar</button>
        <span class="dialog-spacer"></span>
        <button type="button" class="secondary-button" @click="emit('close')">Cancelar</button>
        <button class="primary-button">Guardar</button>
      </div>
    </form>
  </div>
</template>
