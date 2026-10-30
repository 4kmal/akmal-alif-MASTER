# Akmal Alif Admin

This application is a private Nuxt worker for the portfolio briefing, analytics, and
shortlink operations. It preserves the Sink link editor, QR workflow, routing options,
health check, migration tools, analytics views, realtime view, OpenAPI, and MCP surface
while adding source-aware portfolio reports.

## Runtime boundary

- `https://www.akmalalif.com/admin` serves the owner UI. Better Auth runs in the portfolio Worker at `/api/auth/*` on that same origin.
- `https://go.akmalalif.com` serves native shortlink resolution and bearer-only APIs.
- The portfolio gateway calls namespaced `/api/admin/*` routes after checking the
  database session and approved provider account. The admin service requires the
  gateway secret, canonical origin, and injected owner context. Guest login and
  static-asset requests carry no owner context.
- Portfolio reports return explicit unavailable states when the analytics worker is not
  configured. They do not render demo or invented values.

Set `ADMIN_EMAIL` explicitly for the owner allow-list and `PORTFOLIO_GATEWAY_TOKEN`
as an encrypted secret shared with the portfolio Worker. The OAuth credentials and
`BETTER_AUTH_SECRET` belong to the portfolio Worker, not this service. The existing
Cloudflare Access configuration supports the compatible rollout and rollback gate.
`ALLOW_LOCAL_ADMIN=true` is reserved for an explicitly configured local gateway.
See [the authentication runbook](../../docs/admin-auth.md) for setup and cutover.

## Local-only workflow

Use the Nuxt server at `http://127.0.0.1:7466/admin` for the fastest local UI loop. Put
these values in an untracked `apps/admin/.env.local` file and never reuse them in a
deployment environment. Pass that file explicitly because Nuxt does not load this
non-default filename for every command:

```dotenv
ALLOW_LOCAL_ADMIN=true
PORTFOLIO_ADMIN_ORIGIN=http://127.0.0.1:7466
SHORTLINK_ORIGIN=http://127.0.0.1:7466
NUXT_PUBLIC_PREVIEW_MODE=false
```

```powershell
pnpm dev --dotenv .env.local --host 127.0.0.1
```

For a separate Worker-runtime check, build first and run the committed local-only
Wrangler config. It has no production routes, service bindings, remote D1 IDs, R2
bucket, or machine token:

```powershell
pnpm build
pnpm db:migrate:local
pnpm preview:worker:local
```

Open `http://localhost:8788/admin`. This uses Wrangler's local D1/KV stores, so links
created there stay local. Do not use `wrangler.jsonc`, `deploy:worker`, or
`db:migrate:remote` for local testing.

## Feature parity checklist

- [x] Shortlink list, search, filtering, sorting, tags, copy, QR, edit, delete, expiry.
- [x] UTM builder, password/unsafe controls, query passthrough, cloaking, proxy,
      OpenGraph, image upload, device/country routing, optional Workers AI suggestions.
- [x] Link detail analysis, counters, trend, heatmap, locations, dimensions, exports.
- [x] Realtime polling/replay, pause/visibility handling, logs, globe and fallback.
- [x] Link health checks with progress, filtering, stop/clear, and CSV export.
- [x] Link JSON import/export, access CSV export, R2 backup, and D1 migration status.
- [x] OpenAPI and authenticated MCP tools for links and analytics.
- [x] Portfolio briefing, traffic, content, engagement, goals, performance, realtime,
      and retained event-history routes.

## Fresh admin D1 bootstrap

The `DB` binding is the new `akmalalif-admin` database. Apply its migrations in
order with Wrangler; migration `0006_fast_nitro.sql` creates the raw event,
13-month daily-rollup (including `session_hll`), and maintenance-state tables.

```powershell
pnpm db:migrate:local
pnpm wrangler d1 migrations apply DB --remote --config wrangler.jsonc
```

For a dashboard-console bootstrap, execute the SQL files in `drizzle/` from
`0000` through `0006` in filename order, and record the same six migration
rows plus `0006_fast_nitro` in the Wrangler D1 migrations journal. Do not run
`admin-analytics/schema.sql` separately: its tables are already represented by
`0006`, and running both would create an out-of-band schema. `PORTFOLIO_DB` is
the existing portfolio database and deliberately has no `migrations_dir`; it
must never be included in the admin migration command.

The Sink-derived code is adapted from [miantiao-me/Sink](https://github.com/miantiao-me/Sink)
and remains under its AGPL-3.0-only license and notices in `LICENSE`.

## Cloudflare Git builds

Use the existing `4kmal/akmal-alif-MASTER` connection and production branch `main`.
The admin build root is `apps/admin`, build command is `pnpm build`, and deploy
command is `pnpm exec wrangler deploy`. Pin `NODE_VERSION=24.21.0` and
`PNPM_VERSION=11.2.2` in Workers Builds. Its Wrangler configuration supplies the
admin bindings, the `go.akmalalif.com` custom domain and the daily backup/retention
schedule. Keep the admin Worker workers.dev and preview URLs disabled.

For the first release, deploy and verify the admin Worker before enabling the
portfolio gateway deployment. The portfolio keeps its existing root build and
adds the `ADMIN` service binding. The two Workers share the encrypted
`PORTFOLIO_GATEWAY_TOKEN`; the analytics identity key, machine API token and
Cloudflare analytics read token remain encrypted admin runtime secrets.

Verify both owner OAuth providers on `www`, bearer-only API/MCP on `go`, fresh Sink
storage initialization, public shortlink resolution, provider reports and cron
registration. Save both Worker version IDs and the Git commit with private
release evidence before replacing a working deployment. Restore the affected
Worker's previous version if a material smoke-check regression appears.
