<script setup lang="ts">
defineProps<{
  state: 'live' | 'estimated' | 'partial' | 'unavailable' | 'not-instrumented' | 'stale'
}>()

const labels = {
  'live': 'near real-time',
  'estimated': 'estimated',
  'partial': 'partial coverage',
  'unavailable': 'unavailable',
  'not-instrumented': 'not instrumented',
  'stale': 'stale source',
} as const
</script>

<template>
  <span class="source-badge" :data-state="state">
    <span class="source-badge__dot" aria-hidden="true" />
    {{ labels[state] }}
  </span>
</template>
