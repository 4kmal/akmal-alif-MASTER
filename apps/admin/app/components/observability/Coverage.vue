<script setup lang="ts">
import type { SourceCoverage, SourceStatus } from '../../../shared/types/observability'
import { ChevronDown } from '@lucide/vue'
import { computed } from 'vue'

const props = defineProps<{
  coverage: SourceCoverage[]
}>()

const statusLabel: Record<SourceStatus, string> = {
  live: 'Live',
  partial: 'Partial',
  stale: 'Stale',
  unavailable: 'Unavailable',
}

const overallStatus = computed<SourceStatus>(() => {
  if (props.coverage.length === 0 || props.coverage.every(item => item.status === 'unavailable'))
    return 'unavailable'
  if (props.coverage.some(item => item.status === 'stale'))
    return 'stale'
  if (props.coverage.every(item => item.status === 'live'))
    return 'live'
  return 'partial'
})

const statusSummary = computed(() => {
  if (props.coverage.length === 0)
    return 'No provider sources'

  const counts = props.coverage.reduce<Partial<Record<SourceStatus, number>>>((result, item) => {
    result[item.status] = (result[item.status] || 0) + 1
    return result
  }, {})

  return (Object.entries(counts) as Array<[SourceStatus, number]>)
    .filter(([, count]) => count > 0)
    .map(([status, count]) => `${count} ${statusLabel[status].toLowerCase()}`)
    .join(' · ')
})
</script>

<template>
  <details class="observability-coverage">
    <summary class="observability-coverage__summary">
      <span class="observability-status" :data-state="overallStatus">
        <span class="observability-status__dot" aria-hidden="true" />
        Coverage · {{ statusSummary }}
      </span>
      <ChevronDown :size="14" aria-hidden="true" class="observability-coverage__chevron" />
    </summary>
    <div class="observability-coverage__details" aria-label="Data source coverage">
      <div
        v-for="item in coverage"
        :key="`${item.source}-${item.checkedAt}`"
        class="observability-coverage__item"
      >
        <span
          class="observability-status"
          :data-state="item.status"
          :title="item.reason || `${item.source}: ${statusLabel[item.status]}`"
        >
          <span class="observability-status__dot" aria-hidden="true" />
          {{ statusLabel[item.status] }}
        </span>
        <span class="observability-coverage__source">{{ item.source }}</span>
        <span v-if="item.reason" class="observability-coverage__reason">{{ item.reason }}</span>
      </div>
      <p v-if="coverage.length === 0" class="observability-coverage__empty">No provider source reported coverage.</p>
    </div>
  </details>
</template>
