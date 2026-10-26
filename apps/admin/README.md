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
- [x] Portfolio briefing, traffic, content, engagement, goals, and performance routes.

The Sink-derived code and notices remain under the project license in `LICENSE`.
