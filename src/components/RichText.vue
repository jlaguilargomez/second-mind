<script setup>
defineProps({
  text: { type: String, default: '' },
})

const emit = defineEmits(['context', 'tag'])

function tokens(text) {
  const parts = text.split(/(\[\[[^\]]+\]\]|@[\p{L}\p{N}_/-]+|#[\p{L}\p{N}_/-]+)/gu)
  return parts.filter(Boolean).map((part) => {
    if (part.startsWith('[[')) return { type: 'context', value: part.slice(2, -2), raw: part }
    if (part.startsWith('@')) return { type: 'context', value: part.slice(1), raw: part }
    if (part.startsWith('#')) return { type: 'tag', value: part.slice(1), raw: part }
    return { type: 'text', value: part, raw: part }
  })
}
</script>

<template>
  <span>
    <template v-for="(token, index) in tokens(text)" :key="`${token.raw}-${index}`">
      <button
        v-if="token.type === 'context'"
        class="inline-context"
        @click.stop="emit('context', token.value)"
      >@{{ token.value }}</button>
      <button
        v-else-if="token.type === 'tag'"
        class="inline-tag"
        @click.stop="emit('tag', token.value)"
      >#{{ token.value }}</button>
      <template v-else>{{ token.value }}</template>
    </template>
  </span>
</template>
