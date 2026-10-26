<script setup lang="ts">
definePageMeta({ layout: 'dashboard' })
</script>

<template>
  <div class="space-y-6">
    <PortfolioReport
      report="performance"
      title="Performance"
      intro="Keep route speed, asset failures, and availability beside audience signals without turning them into engagement claims."
    />
    <PortfolioIntegrationNotes />
  </div>
</template>
