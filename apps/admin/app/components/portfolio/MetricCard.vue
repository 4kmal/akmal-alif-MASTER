<script setup lang="ts">
withDefaults(defineProps<{
  label: string
  value?: string | number | null
  detail?: string
  state?: 'live' | 'estimated' | 'partial' | 'unavailable' | 'not-instrumented' | 'stale'
}>(), {
  value: null,
  detail: '',
  state: undefined,
})
</script>

<template>
  <article class="portfolio-metric">
    <div class="portfolio-metric__topline">
      <span class="portfolio-eyebrow">{{ label }}</span>
      <PortfolioSourceBadge v-if="state" :state="state" />
    </div>
    <strong class="portfolio-metric__value">{{ value ?? '—' }}</strong>
    <span v-if="detail" class="portfolio-metric__detail">{{ detail }}</span>
  </article>
</template>
