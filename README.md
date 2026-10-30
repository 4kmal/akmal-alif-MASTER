# Akmal Alif Portfolio

Vite 5, plain HTML, CSS and JavaScript, served by Cloudflare Workers Static Assets. The existing multi-page design and clean URLs are preserved.

| Resource | Name / binding |
| --- | --- |
| Worker | `akmalalif-portfolio` |
| Static build | `dist/` / `ASSETS` |
| D1 | `akmalalif-portfolio` / `DB` |
| R2 | `akmalalif-portfolio-media` / `MEDIA` |
| Admin service | `akmalalif-admin` / `ADMIN` |
| Preview | `https://akmalalif-portfolio.iamaleep.workers.dev` |
| Canonical domain | `https://www.akmalalif.com` |

`wrangler.jsonc` contains the resource configuration. D1 ID: `675ccbd5-f4aa-4ad6-b292-0d8fac7c54d5`. Worker invocation logs are enabled. Cloudflare Web Analytics is configured through the dashboard.

## Development

Use Node **24.21.0** and pnpm **11.2.2**, pinned in `.nvmrc`, `package.json` and Cloudflare build settings.

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

Open `http://localhost:3000`. Vite serves source files immediately, hot-swaps CSS without interrupting music, and reloads HTML partials and JavaScript changes automatically. No build, database import or Cloudflare login is required for frontend work. `repo-reference/`, build output and local Worker state are excluded from the build/watch inputs.

The frontend forwards public API and R2 media reads to `https://www.akmalalif.com`, including the three original video URLs. Only GET/HEAD requests are forwarded; visits from localhost are not recorded. Public lifetime counters refresh every 15 seconds while the page is visible and online, retaining their last successful values during an interruption.

For backend development, run the local Worker separately:

```powershell
pnpm exec wrangler d1 execute akmalalif-portfolio --local --file migrations/0001_initial.sql
pnpm build
pnpm dev:worker
```

Wrangler serves the complete app at `http://localhost:8787`. To read that backend through Vite, copy `.env.example` to `.env.local`, set `PORTFOLIO_DEV_BACKEND=http://localhost:8787`, and restart `pnpm dev`. Vite still blocks write forwarding; test writes directly against the local Worker. Local D1/R2 data stay under ignored `.wrangler/`. Seed private article data and media locally when required. The native file watcher is used by default; set `CHOKIDAR_USEPOLLING=true` only if your filesystem needs polling.

```powershell
pnpm test
pnpm build
pnpm exec wrangler deploy --dry-run
```

Tests execute the real schema and Worker SQL through Node SQLite. Coverage includes published/future/draft filtering, missing posts, atomic visit updates and rollback, clean routes, and media range/HEAD requests.

## Private administration

The separate Sink-based Nuxt application lives in `apps/admin`. Its browser interface is served through the portfolio Worker at `https://www.akmalalif.com/admin`. Better Auth in the portfolio Worker authenticates the approved Google and GitHub identities, then forwards a trusted owner context to the private admin service. Native short links and bearer-authenticated Sink API/MCP clients use `https://go.akmalalif.com`.

The admin service has its own D1 database, KV namespace, private R2 bucket, two Analytics Engine datasets and Workers AI binding. The portfolio's existing content database, lifetime counters and media bucket remain separate. See [the admin app](apps/admin/README.md) for setup and [the Sink parity checklist](docs/admin-sink-parity.md) for feature and release evidence.

Install the admin dependencies separately, using the same pinned runtime:

```powershell
pnpm --dir apps/admin install --frozen-lockfile
pnpm dev:admin
pnpm test:admin
pnpm check:admin
pnpm build:admin
```

Frontend development at port 3000 continues to block API writes. The admin's local backend workflow uses explicit local settings and local storage; production credentials belong in encrypted Cloudflare secrets.

See [admin authentication](docs/admin-auth.md) for the owner policy, root `.env` setup, provider callbacks, deployment order, and verification requirements. Cloudflare Access remains the rollback gate until the Better Auth production cutover is verified.

Portfolio events use first-party anonymous browser and session identifiers. Reports label visitors as browser estimates and active visitors as active within five minutes. Sessions expire after 30 minutes of inactivity. Detailed records are retained for 90 days and mergeable daily summaries for 13 months. Imported page history is labelled as legacy recorded events, with no invented historical visitors or engagement. Contact interactions measure intent because the public chat is a local simulation.

The analytics datasets have separate schemas: `akmalalif_shortlinks` retains Sink's aggregate contract; `akmalalif_portfolio` receives portfolio event records. Raw IP, full user-agent and precise location stay in the protected D1 history. Neither public lifetime counters nor GET polling records an additional visit.

## HTTP interface

- `GET /api/blog/categories`: active categories, ordered by sort order/name.
- `GET /api/blog/posts`: published posts whose publication time has passed.
- `GET /api/blog/posts/:slug`: one published post, or JSON `null`.
- `GET /api/profile-metrics`: views and blog impressions.
- `POST /api/profile-metrics`: record a visit and update counters in one D1 batch.
- `POST /api/events`: bounded, deduplicated portfolio event batches from the canonical site.
- `GET /api/admin/overview`: private briefing data.
- `GET /api/admin/portfolio/*`: private portfolio reports and retained history.
- `/api/admin/sink/*`: owner-authenticated Sink operations through the service gateway.

The Worker accepts writes on `www.akmalalif.com` and localhost for direct local API testing. Browser visit tracking writes only on `www.akmalalif.com`; localhost and workers.dev previews only read metrics. Browser tracking retains the per-path session key, and polling never records visits. Any path beginning `/blog`, including `/blogs`, increments impressions. Paths are truncated to 512 Unicode characters; referrer/user agent to 1,024.

`/blogs` serves `blog.html`; `/blog/:slug` serves its article HTML. Former `.html` URLs redirect with 308 while preserving queries. Existing directory pages and the deployed `contoh/awge-website` examples remain available.

## Media

`/media/<key>` serves original CloudFront media from private R2 through the Worker. Original LFS paths also map directly to R2:

- `/assets/video/brandon.mp4`
- `/assets/video/zopo%20(@aesopcash).mp4`
- `/blog/blogpic/thumb1.mp4`

MP4s are excluded from the static build so LFS pointers cannot be served as videos. Media supports seeking, HEAD, ETags and one-day caching. Fonts and Three.js are bundled locally. Social links and external video embeds remain external.

## Data and editing

Use D1 Studio to edit content. Seven tables preserve article/category/tag relationships, counters and visit history. Former Supabase user IDs remain text metadata. Published posts require `status='published'` and a UTC `published_at` in the past.

Keep exports, generated SQL, media manifests and rollback records outside Git. Convert dashboard SQL exports with:

```powershell
node scripts/import-supabase.mjs --input <private-export-directory> --output <private-import.sql>
```

For the dashboard console, add `--single-line --chunks-dir <private-chunk-directory>`. Content newlines are preserved with SQLite `char()` expressions. D1 supplies transaction handling; imports contain no explicit transaction markers. Apply the schema first and import into a new database; regular inserts reject duplicate data.

`node scripts/prepare-media.mjs --help` describes media preparation. Its private manifest records original URLs, object keys, sizes and SHA-256 hashes.

## Deployment

Workers Builds uses the existing `4kmal/akmal-alif-MASTER` GitHub connection, production branch `main`, root `/`, Node `24.21.0`, pnpm `11.2.2`, build `pnpm build`, deploy `pnpm exec wrangler deploy`. Preview builds are disabled. Bindings come from `wrangler.jsonc`.

Verify a deployment against the private article exports and media manifest:

```powershell
node scripts/verify-deployment.mjs --base https://www.akmalalif.com --backup-dir <private-backup-directory>
```

Production verification reads data without adding visits. The workers.dev check also verifies that visit writes are suppressed. Reports stay in the private backup directory.

`www` uses a Worker Custom Domain. The apex uses a proxied placeholder DNS record and a Cloudflare 308 redirect to `www`, preserving paths and queries. Keep the registrar and Cloudflare nameservers unchanged.

For rollback, use the saved original DNS zone and Vercel deployment. Retain the old deployment, Supabase exports and media backup; permanent deletion is separate from routine deployment.
