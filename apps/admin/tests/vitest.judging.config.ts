import { readdirSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

const appRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const pluginDirectory = readdirSync(resolve(appRoot, 'node_modules/.pnpm')).find(name => name.startsWith('@vitejs+plugin-vue@'))
if (!pluginDirectory) throw new Error('The transitive Vue Vite plugin is unavailable.')
const { default: vue } = await import(pathToFileURL(resolve(appRoot, `node_modules/.pnpm/${pluginDirectory}/node_modules/@vitejs/plugin-vue/dist/index.mjs`)).href)

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
