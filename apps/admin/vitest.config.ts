import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

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
  plugins: [
    cloudflareTest({
      wrangler: {
        // Keep the worker pool hermetic: the production config contains a
        // service binding and remote resources that cannot be used in tests.
        configPath: './tests/wrangler.security.jsonc',
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
    isolate: false,
    maxWorkers: 1,
    testTimeout: 10_000,
    onUnhandledError(error) {
      return !isHandledValidationError(error)
    },
  },
}))
