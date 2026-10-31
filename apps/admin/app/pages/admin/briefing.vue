<script setup lang="ts">
definePageMeta({ layout: 'dashboard' })
</script>

<template>
  <div class="grid min-w-0 gap-4">
    <PortfolioReport
      report="overview"
      title="Briefing"
      intro="Reach, engagement, career contact, and shortlink activity in one clear view."
    />
    <ObservabilitySummary />
  </div>
</template>
