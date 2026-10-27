import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

const appRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': resolve(appRoot, 'app'),
      '#shared': resolve(appRoot, 'shared'),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['tests/judging-workspace.behavior.test.ts'],
    testTimeout: 10_000,
  },
})
