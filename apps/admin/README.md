# Akmal Alif Admin

This application is a private Nuxt worker for the portfolio briefing, analytics, and
shortlink operations. It preserves the Sink link editor, QR workflow, routing options,
health check, migration tools, analytics views, realtime view, OpenAPI, and MCP surface
while adding source-aware portfolio reports.

## Runtime boundary

- `https://www.akmalalif.com/admin` serves the owner UI and uses Cloudflare Access.
- `https://go.akmalalif.com` serves native shortlink resolution and bearer-only APIs.
- The public portfolio gateway may call namespaced `/api/admin/*` routes with the
  `x-portfolio-gateway` secret after Access validation; this worker validates the
  forwarded Access assertion again and the browser never receives the secret.
- Portfolio reports return explicit unavailable states when the analytics worker is not
  configured. They do not render demo or invented values.

Set `ADMIN_EMAIL` explicitly for the owner allow-list, `PORTFOLIO_GATEWAY_TOKEN` as an
encrypted secret, and `CF_ACCESS_TEAM_DOMAIN` / `CF_ACCESS_AUD` (or their `NUXT_`
runtime aliases) before enabling the production route. `ALLOW_LOCAL_ADMIN=true` is
reserved for an explicitly configured local gateway.

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
