<script setup>
import { computed, ref, watch } from 'vue'
import { isoDate, reminderDate } from '../lib/markdown'

const props = defineProps({
  selectedDate: { type: String, required: true },
  journals: { type: Array, default: () => [] },
  reminders: { type: Array, default: () => [] },
})

const emit = defineEmits(['select'])
const cursor = ref(new Date(`${props.selectedDate}T12:00:00`))

watch(
  () => props.selectedDate,
  (date) => {
    cursor.value = new Date(`${date}T12:00:00`)
  },
)

const monthLabel = computed(() =>
  cursor.value.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
)
const days = computed(() => {
  const year = cursor.value.getFullYear()
  const month = cursor.value.getMonth()
  const first = new Date(year, month, 1)
  const offset = (first.getDay() + 6) % 7
  const start = new Date(year, month, 1 - offset)
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start)
    date.setDate(start.getDate() + index)
    const value = isoDate(date)
    return {
      value,
      number: date.getDate(),
      currentMonth: date.getMonth() === month,
      hasNote: props.journals.some((note) => note.date === value),
      reminderCount: props.reminders.filter(
        (block) => reminderDate(block.reminder) === value,
      ).length,
    }
  })
})

function moveMonth(amount) {
  cursor.value = new Date(cursor.value.getFullYear(), cursor.value.getMonth() + amount, 1)
}
</script>

<template>
  <section class="calendar-panel">
    <header>
      <strong>{{ monthLabel }}</strong>
      <div>
        <button aria-label="Mes anterior" @click="moveMonth(-1)">‹</button>
        <button aria-label="Mes siguiente" @click="moveMonth(1)">›</button>
      </div>
    </header>
    <div class="calendar-weekdays">
      <span v-for="day in ['L', 'M', 'X', 'J', 'V', 'S', 'D']" :key="day">{{ day }}</span>
    </div>
    <div class="calendar-grid">
      <button
        v-for="day in days"
        :key="day.value"
        :class="{
          muted: !day.currentMonth,
          selected: day.value === selectedDate,
          today: day.value === isoDate(),
          'has-note': day.hasNote,
        }"
        @click="emit('select', day.value)"
      >
        {{ day.number }}
        <i v-if="day.reminderCount">{{ day.reminderCount }}</i>
      </button>
    </div>
  </section>
</template>
