<script setup lang="ts">
import { computed } from 'vue'
import { formatObservabilityMetric, formatObservabilityNumber, observabilityCoverageStatus, observabilityMetricTitle, observabilityNumberTitle, useObservabilitySummary } from '@/composables/useObservability'

const { data, loading, error, stale } = useObservabilitySummary()
const cloudMetrics = computed(() => data.value?.cloudflare.metrics || [])
const gamingMetrics = computed(() => data.value?.gaming.overview || [])
const cloudStatus = computed(() => observabilityCoverageStatus(data.value?.cloudflare.coverage || [], stale.value))
const gamingStatus = computed(() => observabilityCoverageStatus(data.value?.gaming.coverage || [], stale.value))
function statusLabel(status: ReturnType<typeof observabilityCoverageStatus>) {
  return ({
    live: 'Live',
    partial: 'Partial',
    stale: 'Stale',
    unavailable: 'Unavailable',
  }[status])
}
</script>

<template>
  <section class="observability-page" aria-labelledby="observability-summary-title">
    <header class="observability-heading">
      <div>
        <p class="portfolio-eyebrow">Platform signals</p>
        <h2 id="observability-summary-title">Cloudflare & gaming</h2>
        <p>Compact source-backed status for the briefing view.</p>
      </div>
      <span v-if="loading" class="observability-status">Refreshing</span>
    </header>
    <p v-if="stale" class="observability-stale" role="status">The summary refresh failed. Showing the last successful response.</p>
    <p v-if="error" class="observability-error" role="alert">{{ error }}</p>
    <div v-if="!data && !loading" class="observability-empty">No observability summary returned.</div>
    <div v-if="data" class="observability-grid">
      <article class="observability-card observability-card--wide">
        <div class="observability-card__header">
          <div><h3>Cloudflare</h3><p>{{ data.cloudflare.meta.scope === 'akmalalif' ? 'Akmal Alif resources' : 'Whole account' }}</p></div>
          <span class="observability-status" :data-state="cloudStatus">{{ statusLabel(cloudStatus) }}</span>
          <ObservabilityCoverage :coverage="data.cloudflare.coverage" />
        </div>
        <ul class="observability-inline-list">
          <li v-for="metric in cloudMetrics.slice(0, 4)" :key="metric.key"><span>{{ metric.label }}</span><strong :title="observabilityMetricTitle(metric)">{{ formatObservabilityMetric(metric) }}</strong></li>
          <li v-if="cloudMetrics.length === 0" class="observability-table__muted">No metrics returned.</li>
        </ul>
      </article>
      <article class="observability-card observability-card--wide">
        <div class="observability-card__header">
          <div><h3>Gaming</h3><p>{{ data.gaming.live.players === null ? 'Live players unavailable' : `${formatObservabilityNumber(data.gaming.live.players)} active humans` }}</p></div>
          <span class="observability-status" :data-state="gamingStatus">{{ statusLabel(gamingStatus) }}</span>
          <ObservabilityCoverage :coverage="data.gaming.coverage" />
        </div>
        <ul class="observability-inline-list">
          <li v-for="metric in gamingMetrics.slice(0, 4)" :key="metric.key"><span>{{ metric.label }}</span><strong :title="observabilityMetricTitle(metric)">{{ formatObservabilityMetric(metric) }}</strong></li>
          <li v-if="gamingMetrics.length === 0" class="observability-table__muted">No metrics returned.</li>
          <li><span>Active bots</span><strong :title="observabilityNumberTitle(data.gaming.live.bots)">{{ formatObservabilityNumber(data.gaming.live.bots) }}</strong></li>
        </ul>
      </article>
    </div>
  </section>
</template>
