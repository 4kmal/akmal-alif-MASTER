<script setup lang="ts">
definePageMeta({ layout: 'dashboard' })
</script>

<template>
  <PortfolioReport
    report="history"
    title="Event history"
    intro="Inspect retained portfolio and shortlink events with bounded filters and a CSV export. Raw detail is kept for 90 days; older context remains in daily summaries."
  />
</template>
