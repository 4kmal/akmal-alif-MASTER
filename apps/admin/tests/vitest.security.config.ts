import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const appRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)))

export default defineConfig({
  resolve: {
    alias: {
      '@portfolio-analytics': path.resolve(appRoot, '../../admin-analytics/index.js'),
      '#shared': path.resolve(appRoot, 'shared'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/admin-security-*.security.ts'],
    testTimeout: 15_000,
  },
})
