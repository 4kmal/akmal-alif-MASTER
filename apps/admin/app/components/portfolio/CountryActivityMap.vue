<!-- eslint-disable better-tailwindcss/no-unknown-classes, vue/singleline-html-element-content-newline -->
<script setup lang="ts">
import type { GeoPermissibleObjects } from 'd3-geo'
import { geoEqualEarth, geoPath } from 'd3-geo'
import { feature } from 'topojson-client'
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { adminAssetURL } from '@/utils/admin-asset'
import { normalizeCountryCode } from './live-activity-helpers'

interface CountryActivityRow {
  countryCode: string
  count: number
}

interface WorldGeometry {
  id?: string | number
  properties?: Record<string, unknown> | null
}

interface WorldGeometryCollection {
  type: 'GeometryCollection'
  geometries: readonly WorldGeometry[]
}

interface WorldTopology {
  type: 'Topology'
  objects: Record<string, WorldGeometryCollection>
  arcs: readonly unknown[]
  transform?: unknown
}

interface GeoFeature {
  type: 'Feature'
  id?: string | number
  properties?: Record<string, unknown> | null
  geometry: unknown
}

interface GeoFeatureCollection {
  type: 'FeatureCollection'
  features: readonly GeoFeature[]
}

interface RenderedCountry {
  key: string
  code: string | null
  name: string
  path: string
  count: number
  level: number
}

const props = defineProps<{ rows: readonly CountryActivityRow[] }>()
const worldTopology = shallowRef<WorldTopology | null>(null)
const mapError = ref(false)
let requestController: AbortController | null = null

const countryCounts = computed(() => new Map(props.rows.map(row => [row.countryCode, row.count])))
const maxCount = computed(() => Math.max(...props.rows.map(row => row.count), 1))

function countryCodeForFeature(country: GeoFeature): string | null {
  const properties = country.properties ?? {}
  return normalizeCountryCode(country.id)
    ?? normalizeCountryCode(properties.iso)
    ?? normalizeCountryCode(properties.ISO_A2)
}

function countryNameForFeature(country: GeoFeature, code: string | null): string {
  const name = country.properties?.name
  return typeof name === 'string' && name.trim() ? name : code ?? 'Unknown country'
}

const renderedCountries = computed<RenderedCountry[]>(() => {
  const topology = worldTopology.value
  const countries = topology?.objects.countries
  if (!topology || !countries)
    return []

  const collection = feature(topology as never, countries as never) as unknown as GeoFeatureCollection
  const projection = geoEqualEarth().fitSize([720, 360], collection as unknown as GeoPermissibleObjects)
  const pathGenerator = geoPath(projection)

  return collection.features.map((country, index) => {
    const code = countryCodeForFeature(country)
    const count = code ? countryCounts.value.get(code) ?? 0 : 0
    return {
      key: `${code ?? 'unknown'}-${index}`,
      code,
      name: countryNameForFeature(country, code),
      path: pathGenerator(country as unknown as GeoPermissibleObjects) ?? '',
      count,
      level: count ? Math.max(1, Math.ceil((count / maxCount.value) * 4)) : 0,
    }
  }).filter(country => country.path)
})

const mapSummary = computed(() => {
  const total = props.rows.reduce((sum, row) => sum + row.count, 0)
  return props.rows.length
    ? `${total} trusted event${total === 1 ? '' : 's'} across ${props.rows.length} countr${props.rows.length === 1 ? 'y' : 'ies'}.`
    : 'No trusted country activity is present in this snapshot.'
})

async function loadWorldMap() {
  requestController?.abort()
  const controller = new AbortController()
  requestController = controller
  mapError.value = false
  try {
    const data = await $fetch<unknown>(adminAssetURL('world.json'), { signal: controller.signal })
    if (!controller.signal.aborted)
      worldTopology.value = data as WorldTopology
  }
  catch {
    if (!controller.signal.aborted)
      mapError.value = true
  }
}

onMounted(() => {
  void loadWorldMap()
})

onBeforeUnmount(() => {
  requestController?.abort()
  requestController = null
})
</script>

<template>
  <div class="portfolio-country-map">
    <p v-if="mapError" class="portfolio-panel__note" role="status">
      The country map is unavailable. Use the trusted country count table below.
    </p>
    <p v-else-if="props.rows.length && !renderedCountries.length" class="portfolio-panel__note" role="status">
      Loading the country map. The trusted count table is available below.
    </p>
    <svg
      v-if="props.rows.length && renderedCountries.length"
      class="portfolio-country-map__svg"
      viewBox="0 0 720 360"
      role="img"
      aria-labelledby="portfolio-country-map-title portfolio-country-map-description"
    >
      <title id="portfolio-country-map-title">Trusted country activity</title>
      <desc id="portfolio-country-map-description">{{ mapSummary }} The map uses trusted country codes only and does not infer precise locations.</desc>
      <path
        v-for="country in renderedCountries"
        :key="country.key"
        class="portfolio-country-map__land"
        :data-level="country.level"
        :d="country.path"
        :aria-label="`${country.name}: ${country.count} event${country.count === 1 ? '' : 's'}`"
        aria-hidden="true"
        focusable="false"
      />
    </svg>
    <p v-if="!props.rows.length" class="portfolio-panel__note" role="status">
      Trusted country fields are not included in this realtime snapshot.
    </p>
    <div class="portfolio-table-wrap">
      <table class="portfolio-table portfolio-country-map__table">
        <caption class="sr-only">Trusted country activity counts</caption>
        <thead><tr><th scope="col">Country</th><th scope="col">Events</th></tr></thead>
        <tbody>
          <tr v-for="row in props.rows" :key="row.countryCode">
            <th scope="row">{{ row.countryCode }}</th>
            <td>{{ row.count }}</td>
          </tr>
          <tr v-if="!props.rows.length">
            <td colspan="2">No trusted country counts are available.</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.portfolio-country-map {
  display: grid;
  gap: 0.8rem;
}

.portfolio-country-map__svg {
  display: block;
  width: 100%;
  height: auto;
  max-height: 18rem;
  color: var(--foreground);
}

.portfolio-country-map__land {
  fill: var(--muted);
  stroke: var(--border);
  stroke-width: 0.7;
  vector-effect: non-scaling-stroke;
}

.portfolio-country-map__land[data-level='1'] {
  fill: color-mix(in srgb, var(--chart-1) 24%, var(--card));
}

.portfolio-country-map__land[data-level='2'] {
  fill: color-mix(in srgb, var(--chart-1) 42%, var(--card));
}

.portfolio-country-map__land[data-level='3'] {
  fill: color-mix(in srgb, var(--chart-1) 62%, var(--card));
}

.portfolio-country-map__land[data-level='4'] {
  fill: var(--chart-1);
}

.portfolio-country-map__table {
  min-width: 0;
}
</style>
