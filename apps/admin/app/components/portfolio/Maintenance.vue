<script setup lang="ts">
const running = ref(false)
const result = ref('')
const error = ref('')

async function run(operation: 'import-legacy' | 'rollup') {
  if (running.value)
    return
  running.value = true
  error.value = ''
  try {
    const response = await useAPI('/api/admin/maintenance', {
      method: 'POST',
      body: { operation },
    })
    result.value = JSON.stringify(response, null, 2)
  }
  catch {
    error.value = 'The operation could not finish. Existing report values are retained; retry when the source is available.'
  }
  finally {
    running.value = false
  }
}
</script>

<template>
  <section class="portfolio-panel portfolio-panel--maintenance" aria-labelledby="portfolio-maintenance-title" :aria-busy="running">
    <div>
      <h2 id="portfolio-maintenance-title">
        Portfolio history
      </h2>
      <p class="portfolio-panel__note">
        Legacy visits retain their original recorded-event label. Daily summaries retain 13 months;
        raw visitor detail expires after 90 days. Both operations can be safely rerun.
      </p>
    </div>
    <div class="portfolio-report__actions">
      <button class="portfolio-button" type="button" :disabled="running" @click="run('import-legacy')">
        Import legacy visits
      </button>
      <button class="portfolio-button" type="button" :disabled="running" @click="run('rollup')">
        Update summaries &amp; retention
      </button>
    </div>
    <p v-if="error" class="portfolio-state portfolio-state--error" role="alert">
      {{ error }}
    </p>
    <pre v-if="result" class="portfolio-maintenance-result" role="status">{{ result }}</pre>
  </section>
</template>
