<script setup>
import { ref, watch } from 'vue'

const props = defineProps({
  block: { type: Object, default: null },
})
const emit = defineEmits(['close', 'save'])
const value = ref('')

function localDate(offset = 0) {
  const date = new Date()
  date.setDate(date.getDate() + offset)
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 10)
}

watch(
  () => props.block,
  (block) => {
    value.value = block?.reminder?.slice(0, 10) || ''
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
        Día
        <input v-model="value" type="date" required />
      </label>
      <div class="quick-date-options">
        <button type="button" @click="value = localDate()">Hoy</button>
        <button type="button" @click="value = localDate(1)">Mañana</button>
        <button type="button" @click="value = localDate(7)">En una semana</button>
      </div>
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
