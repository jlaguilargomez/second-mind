<script setup>
import { tokenizeRichText } from '../lib/richText'

defineProps({
  text: { type: String, default: '' },
})

const emit = defineEmits(['context', 'tag'])
</script>

<template>
  <span>
    <template v-for="(token, index) in tokenizeRichText(text)" :key="`${token.raw}-${index}`">
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
