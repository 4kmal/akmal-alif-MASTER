# Blog studio

Open `https://www.akmalalif.com/admin/blog/posts` with the owner Cloudflare Access session. Blog administration accepts the owner session only; Sink API tokens do not grant authoring access.

## Writing and publishing

Create a post or open an existing one. Changes autosave privately after two seconds. Check the save indicator before leaving. A failed or offline save keeps a browser recovery copy. When another tab changes the draft, review the server version before applying your copy.

The ribbon provides Home, Insert, Layout, Media and Review tools. Use Post details for the excerpt, category, tags, cover, reading time and SEO fields. A slug can change until its first publication. Existing articles keep an original snapshot, and conversion reports unsupported markup before replacing it.

Preview reads the private working copy. Checkpoint creates a point in revision history. Restoring a revision updates the draft; it does not publish it. Publish promotes the draft and its media references together. Unpublish removes it from the public archive. Archive is recoverable.

Import DOCX shows a conversion report before applying content. DOCX export supports text, tables and images; videos and animated GIFs use posters and links. HTML export and Browser PDF are also available. Word pagination and every Word-specific layout feature are not preserved.

## Media projects

Upload originals in Media library. Transfers use 10 MiB parts, with at most two parts running at once. To resume after a reload, reselect the same source file in Transfers. Originals stay immutable and private. A new asset becomes public only while a published article references it.

Select a source to edit an image, construct a sequential video timeline, or edit GIF frames. Save project preserves the editing instructions. Export creates a separate derived asset; download remains available if its upload fails. Use Insert / Media in the editor to attach an asset and provide its caption and alt text.

Heavy editing targets desktop Chrome and Edge. The processor loads only when needed, runs in a dedicated worker, and processes one export at a time. Cancel stops the current operation without changing the original or draft. Limits are 250 MiB of distinct sources per project, five minutes and 1080p for video, and 30 seconds / 15 fps / 720 pixels for GIF output.

Site settings controls blog cover motion for all visitors. Animate once gives each visible cover up to four seconds per page visit. Static, failed configuration reads and reduced motion keep it still.

## Local authoring

Use Node 24.21.0 and pnpm 11.2.2. Public frontend development remains `pnpm dev` at port 3000, with production reads and blocked production writes.

For isolated local authoring, run these commands from `apps/admin`:

```powershell
pnpm install --frozen-lockfile
pnpm editor:runtime
pnpm exec wrangler d1 migrations apply DB --local --config wrangler.local.jsonc
pnpm exec wrangler d1 migrations apply PORTFOLIO_DB --local --config wrangler.local.jsonc
pnpm exec wrangler r2 object put akmalalif-admin-local/editor-runtime/ffmpeg/0.12.10/ffmpeg-core.js --file .editor-runtime/editor-runtime/ffmpeg/0.12.10/ffmpeg-core.js --local --config wrangler.local.jsonc
pnpm exec wrangler r2 object put akmalalif-admin-local/editor-runtime/ffmpeg/0.12.10/ffmpeg-core.wasm --file .editor-runtime/editor-runtime/ffmpeg/0.12.10/ffmpeg-core.wasm --local --config wrangler.local.jsonc
pnpm build
pnpm preview:worker:local
```

Open `http://localhost:8788/admin/blog/posts`. This configuration uses separate local D1 and R2 stores. Its localhost-only owner shortcut is disabled in production. Stop this local Worker before rebuilding on Windows, because it holds the generated assets open.

## Storage and recovery

Portfolio migrations `0002_blog_studio.sql` and `0003_blog_audit.sql` add working documents, immutable revisions, media assets and projects, settings, published references and audit records. Published `content_html` remains the public compatibility representation. The existing portfolio database and media bucket stay authoritative.

The admin Worker requires `PORTFOLIO_DB` and `PORTFOLIO_MEDIA` alongside its existing bindings. Its private `R2` bucket contains the pinned FFmpeg runtime. Never put processor binaries, source exports, local databases or `repo-reference/` into Git or public static assets.

Before a release, save the D1 recovery bookmark and content export. Deploy the admin Worker before the portfolio gateway through their Git connections. Record both deployment versions and commit IDs. A Worker rollback preserves the additive tables; do not remove them as part of a code rollback.

API details and document attributes are in [blog-studio-contract.md](blog-studio-contract.md).
