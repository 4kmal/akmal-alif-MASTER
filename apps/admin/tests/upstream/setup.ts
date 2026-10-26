import { applyD1Migrations, env } from 'cloudflare:test'
import { beforeAll } from 'vitest'

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
  Object.assign(env as unknown as Record<string, unknown>, {
    AI: {
      run: async () => {
        throw new Error('Workers AI unavailable in the hermetic upstream suite')
      },
      toMarkdown: async () => {
        throw new Error('Workers AI unavailable in the hermetic upstream suite')
      },
    },
  })
})
