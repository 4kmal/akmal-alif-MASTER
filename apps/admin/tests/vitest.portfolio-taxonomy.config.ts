import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

export default defineConfig(async () => ({
  plugins: [
    cloudflareTest({
      wrangler: {
        configPath: './tests/wrangler.portfolio-taxonomy.jsonc',
      },
      miniflare: {
        compatibilityDate: '2026-07-15',
        cf: true,
        bindings: {
          PORTFOLIO_MIGRATIONS: await readD1Migrations('../../migrations'),
        },
      },
    }),
  ],
  test: {
    include: ['tests/portfolio-taxonomy-worker.spec.ts'],
    isolate: false,
    maxWorkers: 1,
    setupFiles: ['./tests/portfolio-taxonomy.setup.ts'],
    testTimeout: 20_000,
  },
}))
