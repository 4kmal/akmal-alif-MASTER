<script setup lang="ts">
import JudgingWorkspace from '@/components/judging/JudgingWorkspace.vue'

definePageMeta({
  layout: 'dashboard',
})

useSeoMeta({
  title: 'SDC 2026 judging workspace',
  description: 'Private review workspace for the SDC 2026 judging desk.',
})
</script>

<template>
  <JudgingWorkspace />
</template>
