import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const appRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)))

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(appRoot, 'app'),
      '#shared': path.resolve(appRoot, 'shared'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
