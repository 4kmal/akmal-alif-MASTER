<script setup lang="ts">
import type { SourceCoverage, SourceStatus } from '../../../shared/types/observability'

defineProps<{
  coverage: SourceCoverage[]
}>()

const statusLabel: Record<SourceStatus, string> = {
  live: 'Live',
  partial: 'Partial',
  stale: 'Stale',
  unavailable: 'Unavailable',
}
</script>

<template>
  <div class="observability-coverage" aria-label="Data source coverage">
    <span
      v-for="item in coverage"
      :key="`${item.source}-${item.checkedAt}`"
      class="observability-status"
      :data-state="item.status"
      :title="item.reason || `${item.source}: ${statusLabel[item.status]}`"
    >
      <span class="observability-status__dot" aria-hidden="true" />
      {{ item.source }} · {{ statusLabel[item.status] }}
    </span>
    <span v-if="coverage.length === 0" class="observability-status" data-state="unavailable">
      <span class="observability-status__dot" aria-hidden="true" />
      Coverage unavailable
    </span>
  </div>
</template>
