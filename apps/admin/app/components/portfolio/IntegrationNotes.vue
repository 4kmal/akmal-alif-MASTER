<script setup lang="ts">
import { normalizePublicShortlinkOrigin } from '@/utils/public-shortlink'

const { public: config } = useRuntimeConfig()
const publicOrigin = computed(() => normalizePublicShortlinkOrigin(config.shortlinkOrigin))
</script>

<template>
  <section class="portfolio-panel portfolio-panel--maintenance" aria-labelledby="portfolio-integrations-title">
    <div>
      <h2 id="portfolio-integrations-title">
        Integrations &amp; access
      </h2>
      <p class="portfolio-panel__note">
        This browser uses your Cloudflare Access session. Machine clients use a separate private bearer token;
        never paste that token into this dashboard or a public short URL.
      </p>
    </div>
    <dl class="portfolio-integration-list">
      <div><dt>Short links</dt><dd>{{ publicOrigin }}/:slug</dd></div>
      <div><dt>Sink API</dt><dd>{{ publicOrigin }}/api/link/list</dd></div>
      <div><dt>MCP transport</dt><dd>{{ publicOrigin }}/api/mcp · authenticated HTTP POST</dd></div>
      <div><dt>AI suggestions</dt><dd>Review suggested fields in the link editor before saving.</dd></div>
      <div><dt>Webhooks</dt><dd>Inactive until a destination is configured in the Worker settings.</dd></div>
      <div><dt>Reverse proxy</dt><dd>Disabled by default. Requires both the Worker option and the per-link control.</dd></div>
    </dl>
    <pre class="portfolio-maintenance-result"><code>curl '{{ publicOrigin }}/api/link/list' \
  -H "Authorization: Bearer $SINK_TOKEN"</code></pre>
    <p class="portfolio-panel__note">
      Adapted from <a href="https://github.com/miantiao-me/Sink" target="_blank" rel="noopener noreferrer">Sink</a>
      under AGPL-3.0. Application source, notices and local setup are in this portfolio's
      <a href="https://github.com/4kmal/akmal-alif-MASTER/tree/main/apps/admin" target="_blank" rel="noopener noreferrer">admin workspace</a>.
    </p>
  </section>
</template>
