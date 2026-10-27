import { applyD1Migrations, env } from 'cloudflare:test'
import { beforeAll } from 'vitest'

beforeAll(async () => {
  await applyD1Migrations(env.PORTFOLIO_DB, env.PORTFOLIO_MIGRATIONS)
})
