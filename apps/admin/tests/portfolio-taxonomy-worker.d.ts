import type { D1Migration } from 'cloudflare:test'

declare namespace Cloudflare {
  interface Env {
    PORTFOLIO_MIGRATIONS: D1Migration[]
  }
}
