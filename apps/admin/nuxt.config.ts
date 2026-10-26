import { randomBytes } from 'node:crypto'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import { currentLocales } from './i18n/i18n'

const portfolioAnalyticsPath = fileURLToPath(new URL('../../admin-analytics/index.js', import.meta.url))

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  alias: {
    // Keep the shared analytics Worker import resolvable in both Vite dev and
    // the Cloudflare Nitro bundle when the source lives outside this app.
    '@portfolio-analytics': portfolioAnalyticsPath,
  },
  ssr: false,
  modules: [
    '@nuxtjs/color-mode',
    '@nuxtjs/i18n',
    '@nuxt/eslint',
    '@pinia/nuxt',
    'shadcn-nuxt',
  ],
  colorMode: {
    preference: 'system',
    fallback: 'light',
    classSuffix: '',
    dataValue: 'theme',
    storage: 'localStorage',
    storageKey: 'theme',
  },
  app: {
    // Keep Nitro's native APIs at the root paths consumed by the portfolio
    // gateway. Browser chunks remain private under the admin namespace.
    baseURL: '/',
    buildAssetsDir: '/admin/_nuxt/',
  },
  css: ['@/assets/css/tailwind.css'],
  runtimeConfig: {
    siteToken: process.env.NUXT_SITE_TOKEN || randomBytes(32).toString('base64url'),
    cfAccessTeamDomain: process.env.NUXT_CF_ACCESS_TEAM_DOMAIN || process.env.CF_ACCESS_TEAM_DOMAIN || '',
    cfAccessAud: process.env.NUXT_CF_ACCESS_AUD || process.env.CF_ACCESS_AUD || '',
    redirectStatusCode: '301',
    linkCacheTtl: 60,
    redirectWithQuery: false,
    redirectNoStore: false,
    // Deprecated NUXT_HOME_URL alias; kept so pre-public deployments keep redirecting `/`.
    homeURL: '',
    // Analytics helpers also read the direct Worker variable at runtime. Keep
    // the build-time value aligned with the public account identifier when the
    // same app is run through Nuxt locally.
    cfAccountId: process.env.NUXT_CF_ACCOUNT_ID || process.env.CF_ACCOUNT_ID || '',
    cfApiToken: '',
    portfolioAdminOrigin: process.env.PORTFOLIO_ADMIN_ORIGIN || 'https://www.akmalalif.com',
    shortlinkOrigin: process.env.SHORTLINK_ORIGIN || 'https://go.akmalalif.com',
    portfolioGatewayToken: process.env.PORTFOLIO_GATEWAY_TOKEN || '',
    allowLocalAdmin: process.env.ALLOW_LOCAL_ADMIN === 'true',
    adminEmail: process.env.NUXT_ADMIN_EMAIL || process.env.ADMIN_EMAIL || '',
    portfolioAnalyticsUrl: process.env.PORTFOLIO_ANALYTICS_URL || '',
    dataset: 'sink',
    aiModel: '@cf/qwen/qwen3-30b-a3b-fp8',
    aiPrompt: `You are a URL shortening assistant, please shorten the URL provided by the user into a SLUG. The SLUG information should be derived from the URL and page content (if provided). Do not make any assumptions beyond the given information. A SLUG is human-readable and should not exceed three words and can be validated using regular expressions {slugRegex} . Only the best one is returned, the format must be JSON reference {"slug": "example-slug"}`,
    aiOgPrompt: `You are an OpenGraph metadata assistant. Please summarize the page content provided by the user into a perfect title and description for an OpenGraph preview. Do not make any assumptions beyond the given information. Only the best one is returned, the format must be JSON reference {"title": "Example Title", "description": "Example description that summarizes the page accurately."}`,
    caseSensitive: false,
    importRequestLimit: 100,
    listQueryLimit: 500,
    disableBotAccessLog: false,
    disableAutoBackup: false,
    notFoundRedirect: '',
    safeBrowsingDoh: '', // Set to DoH URL to enable auto-detection, e.g. https://family.cloudflare-dns.com/dns-query
    webhookUrl: '',
    webhookSecret: '',
    public: {
      previewMode: (process.env.NUXT_PUBLIC_PREVIEW_MODE || '').trim().toLowerCase() === 'true',
      adminOrigin: process.env.PORTFOLIO_ADMIN_ORIGIN || 'https://www.akmalalif.com',
      shortlinkOrigin: process.env.SHORTLINK_ORIGIN || 'https://go.akmalalif.com',
      slugDefaultLength: '6',
      kvBatchLimit: '50',
      maxUrlLength: '16384',
      homeURL: process.env.NUXT_HOME_URL || '',
      linkProxyEnabled: false,
    },
  },
  routeRules: {
    '/admin': {
      redirect: '/admin/briefing',
    },
    '/api/**': {
      cors: false,
    },
    '/_docs/**': {
      headers: { 'X-Robots-Tag': 'noindex, follow' },
    },
    '/admin/sphere.bin': {
      headers: { 'Cache-Control': 'public, max-age=0, must-revalidate' },
    },
    '/admin/*.json': {
      headers: { 'Cache-Control': 'public, max-age=2592000, immutable' },
    },
    '/admin/*.geojson': {
      headers: { 'Cache-Control': 'public, max-age=2592000, immutable' },
    },
  },
  experimental: {
    enforceModuleCompatibility: true,
  },
  typescript: {
    tsConfig: {
      compilerOptions: {
        types: ['vite/client'],
      },
    },
  },
  compatibilityDate: '2026-07-13',
  nitro: {
    alias: {
      '@portfolio-analytics': portfolioAnalyticsPath,
    },
    preset: import.meta.env.CF_PAGES !== '1' ? 'cloudflare-module' : undefined,
    experimental: {
      openAPI: true,
    },
    timing: true,
    openAPI: {
      production: 'runtime',
      meta: {
        title: 'Akmal Alif Admin API',
        description: 'Owner-only portfolio analytics and Sink-compatible shortlink operations.\n\n[Return to the portfolio](https://www.akmalalif.com)',
      },
      route: '/_docs/openapi.json',
      ui: {
        scalar: {
          route: '/_docs/scalar',
        },
        swagger: {
          route: '/_docs/swagger',
        },
      },
    },
  },
  vite: {
    plugins: [
      tailwindcss(),
    ],
    optimizeDeps: {
      include: [
        '@internationalized/date',
        '@lucide/vue',
        '@number-flow/vue',
        '@tanstack/vue-form',
        '@unovis/vue',
        '@vue/devtools-core',
        '@vue/devtools-kit',
        '@vueuse/core',
        'class-variance-authority',
        'clsx',
        'd3-geo',
        'd3-scale',
        'nanoid',
        'qr-code-styling', // CJS
        'reka-ui',
        'reka-ui/date',
        'tailwind-merge',
        'twgl.js',
        'vaul-vue',
        'virtua/vue',
        'vue-sonner',
        'vue3-simple-icons',
        'zod',
      ],
    },
  },
  eslint: {
    config: {
      standalone: false,
    },
  },
  i18n: {
    locales: currentLocales,
    compilation: {
      strictMessage: false,
      escapeHtml: true,
    },
    strategy: 'no_prefix',
    serverRoutePrefix: '/admin/_i18n',
    detectBrowserLanguage: {
      useCookie: true,
      cookieKey: 'sink_i18n_redirected',
      redirectOn: 'root',
    },
    baseUrl: 'https://www.akmalalif.com/admin',
    defaultLocale: 'en-US',
  },
  shadcn: {
    prefix: '',
  },
})
