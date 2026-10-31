<script setup lang="ts">
import { computed } from 'vue'
import { formatObservabilityNumber } from '@/composables/useObservability'

interface Point {
  label: string
  value: number
}

const props = withDefaults(defineProps<{
  points: Point[]
  emptyLabel?: string
  unit?: string
  metricLabel?: string
}>(), {
  emptyLabel: 'No series returned for this range.',
  unit: '',
  metricLabel: 'Report trend',
})

const width = 720
const height = 220
const padding = { top: 20, right: 18, bottom: 34, left: 34 }
const innerWidth = width - padding.left - padding.right
const innerHeight = height - padding.top - padding.bottom

const maxValue = computed(() => Math.max(...props.points.map(point => point.value), 1))
const stepX = computed(() => props.points.length > 1 ? innerWidth / (props.points.length - 1) : innerWidth)
const plottedPoints = computed(() => props.points.map((point, index) => ({
  ...point,
  x: padding.left + (props.points.length > 1 ? index * stepX.value : innerWidth / 2),
  y: padding.top + innerHeight - (point.value / maxValue.value) * innerHeight,
})))
const linePath = computed(() => plottedPoints.value.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' '))
const areaPath = computed(() => {
  const first = plottedPoints.value[0]
  const last = plottedPoints.value.at(-1)
  if (!first || !last)
    return ''
  const baseline = padding.top + innerHeight
  return `${linePath.value} L ${last.x.toFixed(2)} ${baseline} L ${first.x.toFixed(2)} ${baseline} Z`
})
const axisLabels = computed(() => plottedPoints.value.filter((_, index) => {
  if (plottedPoints.value.length <= 5)
    return true
  const stride = Math.ceil(plottedPoints.value.length / 4)
  return index === 0 || index === plottedPoints.value.length - 1 || index % stride === 0
}))
const gridRows = computed(() => [0, 0.5, 1].map(ratio => ({
  y: padding.top + ratio * innerHeight,
  label: formatObservabilityNumber(maxValue.value * (1 - ratio), props.unit),
})))
</script>

<template>
  <div class="observability-line-chart" :aria-label="points.length ? metricLabel : emptyLabel">
    <template v-if="points.length">
      <svg viewBox="0 0 720 220" role="img" aria-label="Report trend">
        <line
          v-for="row in gridRows"
          :key="row.y"
          class="observability-line-chart__grid"
          :x1="padding.left"
          :x2="width - padding.right"
          :y1="row.y"
          :y2="row.y"
        />
        <text
          v-for="row in gridRows"
          :key="`label-${row.y}`"
          class="observability-line-chart__axis"
          x="0"
          :y="row.y + 4"
        >{{ row.label }}</text>
        <path class="observability-line-chart__area" :d="areaPath" />
        <path class="observability-line-chart__line" :d="linePath" />
        <circle
          v-for="point in plottedPoints"
          :key="`${point.label}-${point.x}`"
          class="observability-line-chart__point"
          :cx="point.x"
          :cy="point.y"
          r="3.5"
        >
          <title>{{ point.label }}: {{ formatObservabilityNumber(point.value, unit) }}</title>
        </circle>
        <text
          v-for="point in axisLabels"
          :key="`axis-${point.label}`"
          class="observability-line-chart__axis"
          :x="point.x"
          :y="height - 8"
          text-anchor="middle"
        >{{ point.label }}</text>
      </svg>
    </template>
    <p v-else class="observability-empty">{{ emptyLabel }}</p>
  </div>
</template>
