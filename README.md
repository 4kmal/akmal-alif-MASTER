# Akmal Alif Portfolio

Vite 5, plain HTML, CSS and JavaScript, served by Cloudflare Workers Static Assets. The existing multi-page design and clean URLs are preserved.

| Resource | Name / binding |
| --- | --- |
| Worker | `akmalalif-portfolio` |
| Static build | `dist/` / `ASSETS` |
| D1 | `akmalalif-portfolio` / `DB` |
| R2 | `akmalalif-portfolio-media` / `MEDIA` |
| Preview | `https://akmalalif-portfolio.iamaleep.workers.dev` |
| Canonical domain | `https://www.akmalalif.com` |

`wrangler.jsonc` contains the resource configuration. D1 ID: `675ccbd5-f4aa-4ad6-b292-0d8fac7c54d5`. Worker invocation logs are enabled. Cloudflare Web Analytics is configured through the dashboard.

## Development

Use Node **24.21.0** and pnpm **11.2.2**, pinned in `.nvmrc`, `package.json` and Cloudflare build settings.

```powershell
pnpm install --frozen-lockfile
pnpm exec wrangler d1 execute akmalalif-portfolio --local --file migrations/0001_initial.sql
pnpm build
pnpm dev:worker
```

Wrangler serves the complete app at `http://localhost:8787`. For Vite hot reload, run `pnpm dev` in a second terminal; it proxies `/api` and `/media` to Wrangler. Local D1/R2 data stay under ignored `.wrangler/`. Seed private article data and media locally when required.

```powershell
pnpm test
pnpm build
pnpm exec wrangler deploy --dry-run
```

Tests execute the real schema and Worker SQL through Node SQLite. Coverage includes published/future/draft filtering, missing posts, atomic visit updates and rollback, clean routes, and media range/HEAD requests.

## HTTP interface

- `GET /api/blog/categories`: active categories, ordered by sort order/name.
- `GET /api/blog/posts`: published posts whose publication time has passed.
- `GET /api/blog/posts/:slug`: one published post, or JSON `null`.
- `GET /api/profile-metrics`: views and blog impressions.
- `POST /api/profile-metrics`: record a visit and update counters in one D1 batch.

Writes are allowed on `www.akmalalif.com` and localhost. The workers.dev address returns metrics without recording visits. Browser tracking retains the per-path session key. Any path beginning `/blog`, including `/blogs`, increments impressions. Paths are truncated to 512 Unicode characters; referrer/user agent to 1,024.

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
