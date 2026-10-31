<script setup lang="ts">
import type { CloudflareReport, ObservabilityMetric } from '../../../shared/types/observability'
import { Download, ExternalLink, RefreshCw } from '@lucide/vue'
import { useMediaQuery } from '@vueuse/core'
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { aggregateCloudflareSeries, formatObservabilityMetric, formatObservabilityNumber, observabilityCoverageStatus, observabilityMetricTitle, useCloudflareObservability } from '@/composables/useObservability'

const tabs = [
  { id: 'overview', label: 'Overview' },
  { id: 'compute', label: 'Compute' },
  { id: 'storage', label: 'Storage' },
  { id: 'traffic', label: 'Traffic' },
  { id: 'services', label: 'Services' },
  { id: 'billing', label: 'Billing' },
] as const
type CloudflareTab = typeof tabs[number]['id']

const route = useRoute()
const router = useRouter()
const { data, loading, error, stale, lastUpdated, refresh, range, scope } = useCloudflareObservability()
const activeTab = ref<CloudflareTab>(isTab(route.query.tab) ? route.query.tab as CloudflareTab : 'overview')
const teleportReady = ref(false)
const showHeaderFilters = useMediaQuery('(min-width: 1280px)')
const filtersInHeader = computed(() => teleportReady.value && showHeaderFilters.value)

onMounted(() => {
  teleportReady.value = true
})

function isTab(value: unknown): value is CloudflareTab {
  return typeof value === 'string' && tabs.some(tab => tab.id === value)
}

function handleTabKeydown(event: KeyboardEvent, index: number) {
  const key = event.key
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(key))
    return
  event.preventDefault()
  const nextIndex = key === 'Home'
    ? 0
    : key === 'End'
      ? tabs.length - 1
      : (index + (key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
  const nextTab = tabs[nextIndex]
  if (!nextTab)
    return
  activeTab.value = nextTab.id
  void nextTick(() => document.getElementById(`cloudflare-tab-${nextTab.id}`)?.focus())
}

watch(activeTab, (value) => {
  void router.replace({ query: { ...route.query, tab: value === 'overview' ? undefined : value } })
})

watch(() => route.query.tab, (value) => {
  const nextTab: CloudflareTab = isTab(value) ? value : 'overview'
  if (nextTab !== activeTab.value)
    activeTab.value = nextTab
})

const selectedMetrics = computed(() => {
  const report = data.value
  if (!report)
    return []
  if (activeTab.value === 'compute')
    return reportMetrics(report.compute)
  if (activeTab.value === 'storage')
    return reportMetrics([...report.storage, ...report.durableObjects])
  if (activeTab.value === 'traffic')
    return reportMetrics(report.traffic)
  if (activeTab.value === 'services')
    return reportMetrics(report.services)
  if (activeTab.value === 'overview')
    return preferredOverviewMetrics(report)
  return []
})

function reportMetrics(metrics: ObservabilityMetric[], limit = 12) {
  const accountMetrics = metrics.filter(metric => !metric.resourceId)
  return (accountMetrics.length ? accountMetrics : metrics).slice(0, limit)
}

function allReportMetrics(report: CloudflareReport) {
  return [
    ...report.compute,
    ...report.storage,
    ...report.durableObjects,
    ...report.traffic,
    ...report.services,
  ]
}

function preferredOverviewMetrics(report: CloudflareReport) {
  const metrics = reportMetrics(allReportMetrics(report), 100)
  const priorities = [
    /request|invocation|visit/i,
    /error|exception|failure|fail/i,
    /cpu|compute|duration/i,
    /zones\.edgeResponseBytes|r2\.payloadSize|d1\.storage_bytes/i,
  ]
  const selected: ObservabilityMetric[] = []
  for (const pattern of priorities) {
    const metric = metrics.find(candidate => !selected.some(item => item.key === candidate.key && item.resourceId === candidate.resourceId)
      && pattern.test(`${candidate.key} ${candidate.label}`))
    if (metric)
      selected.push(metric)
  }
  for (const metric of metrics) {
    if (selected.length >= 4)
      break
    if (!selected.some(item => item.key === metric.key && item.resourceId === metric.resourceId))
      selected.push(metric)
  }
  return selected.slice(0, 4)
}

const chartMetric = computed<ObservabilityMetric | null>(() => {
  const report = data.value
  if (!report)
    return null
  const metrics = selectedMetrics.value.length ? selectedMetrics.value : reportMetrics(allReportMetrics(report), 100)
  const hasSeries = (metric: ObservabilityMetric) => report.series.some(point => point.metric === metric.key
    && (!metric.resourceId || point.resourceId === metric.resourceId))
  return metrics.find(metric => !metric.resourceId && hasSeries(metric))
    || metrics.find(hasSeries)
    || null
})

const chartPoints = computed(() => {
  const report = data.value
  if (!report)
    return []
  const metric = chartMetric.value
  if (!metric)
    return []
  return aggregateCloudflareSeries(report.series, metric, range.value).map(point => ({
    label: formatChartDate(point.timestamp),
    value: point.value,
  }))
})

const scopeLabel = computed(() => scope.value === 'account' ? 'Whole account' : 'Akmal Alif resources')
const reportStatus = computed(() => observabilityCoverageStatus(data.value?.coverage || [], stale.value))
const reportStatusLabel = computed(() => ({
  live: 'Live response',
  partial: 'Partial response',
  stale: 'Stale response',
  unavailable: 'Unavailable',
}[reportStatus.value]))
const memoryMetrics = computed(() => data.value?.compute.filter(metric => /memory|headroom/i.test(`${metric.key} ${metric.label}`)) || [])

function metricReason(metric: ObservabilityMetric) {
  if (metric.value === null)
    return metric.detail || 'Provider did not return this metric.'
  if (metric.detail?.startsWith('Aggregate across the selected window;'))
    return null
  return metric.detail
}

function formatDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date)
}

function formatChartDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.valueOf()))
    return value
  return new Intl.DateTimeFormat(undefined, range.value === '24h'
    ? { hour: 'numeric', minute: '2-digit' }
    : { month: 'short', day: 'numeric' }).format(date)
}

function formatDateTime(value: string | null | undefined) {
  if (!value)
    return '—'
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

function downloadCsv(filename: string, rows: string[][]) {
  if (!import.meta.client || rows.length === 0)
    return
  const csv = rows.map(row => row.map(cell => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function exportReport() {
  const report = data.value
  if (!report)
    return
  downloadCsv(`cloudflare-${range.value}.csv`, [
    ['section', 'key', 'label', 'value', 'unit', 'resource'],
    ...selectedMetrics.value.map(metric => ['metric', metric.key, metric.label, String(metric.value ?? ''), metric.unit, metric.resourceName || '']),
    ...report.resources.map(resource => ['resource', resource.id, resource.name, '', resource.kind, resource.project]),
  ])
}

function billingValue(value: number | null, currency: string) {
  return value === null ? '—' : new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(value)
}

function metricCardLabel(metric: ObservabilityMetric) {
  return metric.label || metric.key
}

function resourceMetricSummary(resourceId: string) {
  const report = data.value
  if (!report)
    return '—'
  const metrics = [...report.compute, ...report.durableObjects, ...report.storage, ...report.traffic, ...report.services]
    .filter(metric => metric.resourceId === resourceId)
  return metrics.length ? `${metrics.length} metric${metrics.length === 1 ? '' : 's'}` : 'No scoped metrics'
}

function billingUsageValue(value: number | null, unit: string) {
  return formatObservabilityNumber(value, unit)
}
</script>

<template>
  <section class="observability-page" aria-labelledby="cloudflare-report-title">
    <header class="observability-heading">
      <div>
        <p class="portfolio-eyebrow">Cloudflare observability</p>
        <h1 id="cloudflare-report-title">Cloudflare</h1>
        <p>Account usage, resource attribution, traffic, and billing coverage in one report.</p>
      </div>
    </header>

    <Teleport v-if="teleportReady" to="#dashboard-header-actions">
      <div class="observability-controls">
        <button class="observability-button" type="button" :disabled="loading" @click="refresh">
          <RefreshCw :size="15" :class="{ 'motion-safe:animate-spin': loading }" aria-hidden="true" />
          Refresh
        </button>
        <button class="observability-button" type="button" :disabled="!data" @click="exportReport">
          <Download :size="15" aria-hidden="true" />
          Export CSV
        </button>
      </div>
    </Teleport>

    <Teleport v-if="teleportReady" to="#dashboard-header-actions" defer :disabled="!filtersInHeader">
      <div class="observability-filter-line observability-filter-line--header" aria-label="Cloudflare report filters">
        <label>
          Range
          <select v-model="range" class="observability-filter">
            <option value="24h">Last 24 hours</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
            <option value="13m">Last 13 months</option>
          </select>
        </label>
        <label>
          Scope
          <select v-model="scope" class="observability-filter">
            <option value="account">Whole account</option>
            <option value="akmalalif">Akmal Alif resources</option>
          </select>
        </label>
      </div>
    </Teleport>

    <p class="observability-meta">
      {{ scopeLabel }} · {{ data?.meta?.timezone || 'Timezone unavailable' }}
      <span v-if="lastUpdated"> · refreshed {{ formatDateTime(lastUpdated) }}</span>
    </p>

    <div class="observability-tabs" role="tablist" aria-label="Cloudflare report sections">
      <button
        v-for="(tab, index) in tabs"
        :key="tab.id"
        class="observability-tab"
        :id="`cloudflare-tab-${tab.id}`"
        type="button"
        role="tab"
        :aria-selected="activeTab === tab.id"
        aria-controls="cloudflare-panel"
        :tabindex="activeTab === tab.id ? 0 : -1"
        :data-active="activeTab === tab.id"
        @keydown="handleTabKeydown($event, index)"
        @click="activeTab = tab.id"
      >{{ tab.label }}</button>
    </div>

    <p v-if="stale" class="observability-stale" role="status">The selected filters are still pending or failed. Showing the last successful {{ data?.meta?.scope === 'akmalalif' ? 'Akmal Alif resources' : 'whole account' }} response from {{ formatDateTime(data?.meta?.from) }} to {{ formatDateTime(data?.meta?.to) }}.</p>
    <p v-if="error" class="observability-error" role="alert">{{ error }}</p>
    <p v-else-if="loading && !data" class="observability-empty" aria-live="polite">Loading Cloudflare report…</p>
    <p v-else-if="!data" class="observability-empty">No Cloudflare report returned for this range.</p>

    <template v-if="data">
      <div id="cloudflare-panel" class="observability-panel" role="tabpanel" :aria-labelledby="`cloudflare-tab-${activeTab}`" tabindex="0">
        <div class="observability-card observability-card--full">
          <div class="observability-card__header">
            <div>
              <h2>Source coverage</h2>
              <p>Provider status is reported for this window; open coverage for source details.</p>
            </div>
            <ObservabilityCoverage :coverage="data.coverage" />
          </div>
          <p class="observability-meta">
            {{ formatDateTime(data.meta.from) }} → {{ formatDateTime(data.meta.to) }} · checked {{ formatDateTime(data.meta.checkedAt) }}
            <span v-if="data.meta.trackingStartedAt"> · tracking since {{ formatDate(data.meta.trackingStartedAt) }}</span>
          </p>
        </div>

        <div v-if="activeTab !== 'billing'" class="observability-grid">
          <article v-for="metric in selectedMetrics" :key="`${metric.key}-${metric.resourceId || ''}`" class="observability-card observability-card--metric">
            <div class="observability-card__header">
              <h2>{{ metricCardLabel(metric) }}</h2>
              <span v-if="metric.resourceName" class="observability-status">{{ metric.resourceName }}</span>
            </div>
            <span class="observability-value" :title="observabilityMetricTitle(metric)" :data-unavailable="metric.value === null">{{ formatObservabilityMetric(metric) }}</span>
            <p v-if="metricReason(metric)" class="observability-card__hint">{{ metricReason(metric) }}</p>
          </article>
          <article v-if="selectedMetrics.length === 0" class="observability-card observability-card--full">
            <p class="observability-empty">This section has no metrics in the provider response.</p>
          </article>
        </div>

        <div v-if="activeTab !== 'billing'" class="observability-card observability-card--wide">
          <div class="observability-card__header">
            <div>
              <h2>{{ activeTab === 'overview' ? 'Usage trend' : `${tabs.find(tab => tab.id === activeTab)?.label} trend` }}</h2>
              <p v-if="chartMetric">{{ chartMetric.label }} · {{ scopeLabel }} · {{ chartMetric.unit || 'provider units' }}</p>
              <p v-else>No single metric series is available for this section.</p>
            </div>
            <span class="observability-status" :data-state="reportStatus">{{ reportStatusLabel }}</span>
          </div>
          <ObservabilityLineChart :points="chartPoints" :unit="chartMetric?.unit" :metric-label="chartMetric?.label" />
        </div>

        <article v-if="activeTab !== 'billing'" class="observability-card observability-card--full">
          <div class="observability-card__header">
            <div>
              <h2>Resources</h2>
              <p>Resource attribution is explicit; unassigned and shared resources remain visible.</p>
            </div>
          </div>
          <div class="observability-table-wrap">
            <table class="observability-table">
              <thead><tr><th>Name</th><th>Kind</th><th>Project</th><th>Metrics</th><th>Resource</th></tr></thead>
              <tbody>
                <tr v-for="resource in data.resources" :key="resource.id">
                  <th scope="row">{{ resource.name }}</th>
                  <td>{{ resource.kind }}</td>
                  <td>{{ resource.project }}</td>
                  <td class="observability-table__muted">{{ resourceMetricSummary(resource.id) }}</td>
                  <td><a v-if="resource.url" class="observability-table__action" :href="resource.url" target="_blank" rel="noopener noreferrer"><ExternalLink :size="13" aria-hidden="true" /> Open</a><span v-else class="observability-table__muted">—</span></td>
                </tr>
                <tr v-if="data.resources.length === 0"><td colspan="5" class="observability-table__muted">No resources returned.</td></tr>
              </tbody>
            </table>
          </div>
        </article>

        <article v-if="activeTab === 'compute'" class="observability-card observability-card--full">
          <div class="observability-card__header"><div><h2>Deployments</h2><p>Deployment records are shown only when returned by the provider.</p></div></div>
          <div class="observability-table-wrap">
            <table class="observability-table">
              <thead><tr><th>Resource</th><th>Created</th><th>Source</th><th>ID</th></tr></thead>
              <tbody>
                <tr v-for="deployment in data.deployments" :key="deployment.id"><th scope="row">{{ deployment.resourceName }}</th><td>{{ formatDateTime(deployment.createdAt) }}</td><td>{{ deployment.source || '—' }}</td><td class="observability-table__muted">{{ deployment.id }}</td></tr>
                <tr v-if="data.deployments.length === 0"><td colspan="4" class="observability-table__muted">No deployments returned.</td></tr>
              </tbody>
            </table>
          </div>
        </article>

        <article v-if="activeTab === 'compute' && memoryMetrics.length" class="observability-card observability-card--full">
          <div class="observability-card__header"><div><h2>Isolate memory headroom</h2><p>Sampled memory and the provider limit stay visible with their source units.</p></div></div>
          <div class="observability-table-wrap">
            <table class="observability-table">
              <thead><tr><th>Metric</th><th>Value</th><th>Resource</th><th>Coverage</th></tr></thead>
              <tbody>
                <tr v-for="metric in memoryMetrics" :key="`${metric.key}-${metric.resourceId || ''}`"><th scope="row">{{ metric.label }}</th><td :title="observabilityMetricTitle(metric)">{{ formatObservabilityMetric(metric) }}</td><td>{{ metric.resourceName || 'Account' }}</td><td class="observability-table__muted">{{ metric.detail || '—' }}</td></tr>
              </tbody>
            </table>
          </div>
        </article>

        <article v-if="activeTab === 'billing'" class="observability-card observability-card--full">
          <div class="observability-card__header">
            <div><h2>Billing cycle</h2><p>Billing dates stay separate from the report range.</p></div>
            <span class="observability-status" :data-state="data.billing.status">{{ data.billing.status }}</span>
          </div>
          <div class="observability-grid">
            <article class="observability-card observability-card--metric"><h3>Billed metered usage</h3><span class="observability-value" :data-unavailable="data.billing.actualCharges === null">{{ billingValue(data.billing.actualCharges, data.billing.currency) }}</span><p class="observability-card__hint">Provider BilledCost; subscription fees are separate</p></article>
            <article class="observability-card observability-card--metric"><h3>Estimated charges</h3><span class="observability-value" :data-unavailable="data.billing.estimatedCharges === null">{{ billingValue(data.billing.estimatedCharges, data.billing.currency) }}</span><p class="observability-card__hint">Usage estimate</p></article>
            <article class="observability-card observability-card--metric"><h3>Fixed fees</h3><span class="observability-value" :data-unavailable="data.billing.fixedFees === null">{{ billingValue(data.billing.fixedFees, data.billing.currency) }}</span><p class="observability-card__hint">Plan or fixed component</p></article>
            <article class="observability-card observability-card--metric"><h3>Forecast</h3><span class="observability-value" :data-unavailable="data.billing.forecast === null">{{ billingValue(data.billing.forecast, data.billing.currency) }}</span><p class="observability-card__hint">Projected cycle total</p></article>
          </div>
          <p class="observability-meta">{{ formatDate(data.billing.cycle.from) }} → {{ formatDate(data.billing.cycle.to) }} · source {{ data.billing.cycle.source }}<span v-if="data.billing.pricingAsOf"> · pricing as of {{ formatDate(data.billing.pricingAsOf) }}</span></p>
          <p v-if="data.billing.reason" class="observability-card__hint">{{ data.billing.reason }}</p>
          <div class="observability-table-wrap">
            <table class="observability-table">
              <thead><tr><th>Usage</th><th>Consumed</th><th>Included</th><th>Billable</th><th>Estimate</th><th>Attribution</th></tr></thead>
              <tbody>
                <tr v-for="usage in data.billing.usage" :key="usage.key"><th scope="row">{{ usage.label }}</th><td>{{ billingUsageValue(usage.consumed, usage.unit) }}</td><td>{{ billingUsageValue(usage.included, usage.unit) }}</td><td>{{ billingUsageValue(usage.billable, usage.unit) }}</td><td>{{ billingValue(usage.actualCost ?? usage.estimatedCost, data.billing.currency) }}</td><td>{{ usage.attribution }}</td></tr>
                <tr v-if="data.billing.usage.length === 0"><td colspan="6" class="observability-table__muted">No billing usage rows returned.</td></tr>
              </tbody>
            </table>
          </div>
          <a class="observability-table__action" :href="data.billing.url" target="_blank" rel="noopener noreferrer"><ExternalLink :size="14" aria-hidden="true" /> View billing source</a>
        </article>
      </div>
    </template>
  </section>
</template>
