# Admin observability

The owner dashboard exposes Cloudflare account resources at `/admin/cloudflare`
and Arcade analytics at `/admin/gaming`. Briefing includes a summary of both.
All reports use the existing authenticated `/api/admin/observability/` boundary.

## Cloudflare access

`CF_OBSERVABILITY_TOKEN` belongs to the admin Worker. Keep its value in the ignored
repository-root `.env` and an encrypted `akmalalif-admin` Worker secret. The token
must never be supplied to a public Nuxt setting, browser bundle, URL, or command
argument.

Use an account-owned token limited to account
`73138007ecb740aea99f9c99bb2a2705`. The dashboard needs these read permissions:

- Account Analytics; Billing; Workers Metadata Read-Only.
- D1; Pages; Queues; Workers CI; Workers KV Storage; Workers R2 Storage;
  Workers Observability.
- Zone Read and Analytics Read for zones within this account.

These permissions do not grant resource editing. D1 and storage read scopes can
permit reading data beyond the metadata this dashboard requests. Cloudflare's
Billing Read scope also covers billing profiles and invoices; the dashboard only
returns the charge and subscription fields it uses.

Copy the new token and run these commands from the repository root:

```powershell
Get-Clipboard -Raw | node scripts/observability-secrets.mjs set
node scripts/observability-secrets.mjs status
node scripts/observability-secrets.mjs upload
```

The helper preserves existing environment entries and uploads only
`CF_OBSERVABILITY_TOKEN`. It does not change the OAuth credentials or the existing
portfolio performance token.

## Reading the reports

Cloudflare defaults to the whole account. The akmalalif.com filter selects the
portfolio's resources, including the admin Worker and its shared site bindings.
Account allowances and account charges remain account-wide even when a resource
filter is active.

Provider `BilledCost` covers metered usage, rather than the full invoice.
Subscription fees stay separate. Current storage size is shown in GiB; it is
not a measurement of GB-month consumption. Incomplete billing sources,
unpriced operations, or missing storage-time measurements leave the aggregate
estimate and forecast unavailable. Known operation estimates remain visible.

Usage reports and bills have separate windows. `CF_BILLING_CYCLE_DAY=8` is the
configured fallback when Cloudflare's billing-cycle metadata cannot be read.
The UI identifies that fallback. Actual charges, estimated metered overages,
subscription fees, and forecasts are distinct values. A missing billing feed
does not establish a zero bill. The report links to Cloudflare's billing page.

Memory values are sampled V8 isolate usage in bytes, displayed with units and
percentiles. They are not summed into an account-wide RAM total. CPU totals come
from measured CPU time, not from multiplying a percentile by request count.
Durable Object request estimates apply Cloudflare's 20:1 conversion to incoming
WebSocket messages; the raw message counter remains separate.

Each provider section reports its source, last check, and coverage. `partial`
means some sources could be read. `stale` identifies retained data whose refresh
failed. `unavailable` means no value can be established. These states are not
converted into zeroes.

## Arcade data

Game records are stored separately from website events. A launch, gameplay
heartbeat, or match summary does not increment the website page-view counters.
The existing signed visitor and session cookies link anonymous journeys. Visitor
cookies last about thirteen months; website sessions expire after thirty minutes
of inactivity.

Online EXEPERT outcomes are submitted by the authoritative room server over the
private service binding. Browser events can link a server-issued correlation
token to a visitor, but cannot submit a verified result. Solo EXEPERT and RELAY
RUN scores are labeled client-reported. Kessler Explorer records exploration
interactions rather than scores. Bots are separated from people.

Gaming records omit callsigns, invite codes, IP addresses, input frames, precise
positions, and snapshots. Client batching runs at thirty-second intervals while
active, with lifecycle flushes. Opt-outs and DNT/GPC prevent client tracking and
do not disable the games. Room occupancy comes from confirmed heartbeats and has
a freshness limit. Visiting the dashboard does not wake every room.

Gameplay analytics begins when instrumentation is deployed. Earlier website
visits cannot be reconstructed into past matches or scores.

## Retention and scheduled work

Detailed observability and gaming records are kept for ninety days. Daily
summaries are retained for thirteen months. Cloudflare usage reads are cached for
five minutes; inventory and billing reads are cached for one hour.

The admin Worker has two cron expressions:

| Expression | Work |
| --- | --- |
| `*/15 * * * *` | Collect Cloudflare snapshots |
| `0 0 * * *` | Existing backup/import, analytics maintenance, gaming retention, Cloudflare retention |

Dispatch uses `controller.cron`. The quarter-hour job must not run the daily
backup or legacy import. Failures in one daily job do not prevent the remaining
retention jobs from running.

## Release and rollback

Use Node 24.21.0 and pnpm 11.2.2. Build and validate the admin and portfolio from
the same integration commit. Apply the additive `0008_observability.sql` and
`0009_gaming.sql` migrations to the **admin** D1 database before deploying the
new ingestion code. Do not apply these migrations to portfolio D1.

```powershell
pnpm test
pnpm --dir apps/admin test
pnpm --dir apps/admin test:security
pnpm --dir apps/admin types:check
pnpm --dir apps/admin lint
pnpm build
pnpm --dir apps/admin build
pnpm --dir apps/admin test:worker
pnpm --dir apps/admin test:taxonomy
pnpm exec wrangler d1 migrations apply DB --remote --config apps/admin/wrangler.jsonc
pnpm exec wrangler deploy --config apps/admin/wrangler.jsonc
pnpm exec wrangler deploy --config wrangler.jsonc
```

Verify the authenticated dashboard in both themes and at desktop, tablet, and
mobile widths. Check the source coverage, Cloudflare filter, billing fallback,
game session drilldowns, exports, and avatar fallback. Exercise public game
launches and a disposable online room; confirm telemetry arrives and the room
stops after its last player leaves. Verify signed-out admin APIs still return
401 and direct-service or forged-header requests remain denied.

Rollback restores the previously recorded admin and portfolio Worker versions.
Leave the additive tables in place. Do not restore the old authentication mode
or alter unrelated account resources as part of an observability rollback.

## Verification record

The release evidence is kept in the integration worktree's ignored
`.wrangler/evidence/` directory. Before integration, Node 24.21.0 ran the admin
unit suite with 251 passing tests and five existing judging failures: two
AI-runtime concurrency cases and three workbook formula checks at I13. Release
checks must distinguish those failures from new regressions.

The integrated release passed 235 root tests, 34 admin security tests, 361 admin
Worker tests, the taxonomy suite, and the Node 24.21.0 typecheck. Lint completed
with zero errors. The admin unit suite has 281 passes and the same five judging
failures recorded above. Both production builds completed. The public asset
scan checked 355 text assets without finding the observability token.

On October 31, 2026, the additive admin migrations were applied before deploying
admin version `bd43f150-5e4c-4d3c-96b5-4488e24be8e8` and portfolio version
`57ab2834-a1f6-4ef7-a333-abfc7419a369`. The previous versions were recorded as
`e1e66526-49a7-4aee-beb7-828d2b2c6010` and
`b751ac00-1a4c-4ab2-bb49-74cab33377cf`, respectively.

Authenticated production checks confirmed live Cloudflare sources, project
filtering, account-wide billing coverage, anonymous identity reuse across all
three games, session timelines, and filtered CSV export. A disposable online
room delivered a welcome, a signed correlation token, and 248 snapshots before
disconnecting. The room reported zero humans and an idle state after 66 seconds.
Signed-out observability APIs and a forged direct-service request returned 401.
Dark and light screenshots were captured at desktop, tablet, and mobile sizes
locally, with additional production screenshots of both themes. The production
QA gameplay is real captured activity; no synthetic database fixtures were
inserted into production.

The final UI polish also passed seven focused observability tests, typecheck,
lint, and a fresh admin build. The blog editor and its private reader preview
were exercised in production; editor accents inherit the admin palette while
the preview keeps its own public styling.

The first verified quarter-hour collection ran at 10:00 UTC (18:00 Malaysia time)
on October 31. Remote D1 contained one snapshot for each of `account` and
`akmalalif`, plus 182 and 102 daily metric rows respectively. The provider's
schedule metadata confirmed the quarter-hour trigger was created at 09:42 UTC;
the existing daily trigger retained its original creation timestamp.
