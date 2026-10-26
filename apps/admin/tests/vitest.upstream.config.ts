import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

const require = createRequire(import.meta.url)
const vuePackage = resolve(dirname(require.resolve('nuxt/package.json')), '..', 'vue')
const analyticsPackage = resolve(process.cwd(), '..', '..', 'admin-analytics', 'index.js')

interface HandledValidationError {
  statusCode: 400
  statusMessage: 'Validation Error'
  data: {
    issues: unknown[]
    name: 'ZodError'
    stack: string
  }
}

function isHandledValidationError(error: unknown): error is HandledValidationError {
  if (typeof error !== 'object' || error === null
    || !('statusCode' in error) || error.statusCode !== 400
    || !('statusMessage' in error) || error.statusMessage !== 'Validation Error'
    || !('data' in error) || typeof error.data !== 'object' || error.data === null) {
    return false
  }

  const { data } = error
  return 'issues' in data && Array.isArray(data.issues)
    && 'name' in data && data.name === 'ZodError'
    && 'stack' in data && typeof data.stack === 'string'
    && data.stack.includes('validateData')
}

export default defineConfig(async () => ({
  resolve: {
    // Vue is a Nuxt peer in this app, so pnpm keeps it under Nuxt's package
    // rather than exposing a root dependency. The upstream composable tests
    // import it directly.
    alias: {
      '@portfolio-analytics': analyticsPackage,
      'vue': vuePackage,
    },
  },
  plugins: [
    cloudflareTest({
      wrangler: {
        configPath: './tests/wrangler.upstream.jsonc',
      },
      miniflare: {
        compatibilityDate: '2026-07-15',
        cf: true,
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations('./drizzle'),
        },
      },
    }),
  ],
  test: {
    include: ['tests/upstream/**/*.spec.ts'],
    env: {
      NUXT_SITE_TOKEN: 'test-site-token',
    },
    isolate: false,
    maxWorkers: 1,
    setupFiles: ['./tests/upstream/setup.ts'],
    testTimeout: 20_000,
    onUnhandledError(error) {
      return !isHandledValidationError(error)
    },
  },
}))
