# Admin authentication

The portfolio Worker owns Better Auth at `https://www.akmalalif.com/api/auth/*`.
The Nuxt dashboard stays at `/admin` on the same origin. Authentication records use
the portfolio D1 database; the separate Sink/admin database keeps its existing role.

## Owner identities

Google must return the verified email `iamaleep@gmail.com`. GitHub must return the
immutable account ID `44127834` (`4kmal`) and a verified primary email, including
when the address is private. GitHub's email may differ from Google's. Other Google
accounts and GitHub IDs are rejected before user, account, or session provisioning.

Both identities resolve to the existing `root` owner context with the configured
`ADMIN_EMAIL`. Same-email linking requires verified approved identities. Different
emails may create separate Better Auth users without creating another administrator.

The gateway checks the database session and approved linked account for every
protected request. Cookies are host-only, HttpOnly, Secure in production, and
SameSite=Lax; sessions expire after 24 hours and refresh hourly. Cookie session
caching is disabled so deleted sessions stop authorizing requests immediately.

Better Auth's native D1 adapter does not use interactive transactions. If an
approved login fails while inserting its account, a user row can remain without
an account or session. That row cannot authorize requests; a fresh approved login
reuses it and completes provisioning. A fault-injection regression covers this
recovery. Investigate repeated provisioning failures rather than deleting users
or changing the owner allowlist.

## Root environment and providers

Keep the credentials in the ignored repository-root `.env`.

The root `.htaccess` denies credential files and private workspace directories when
XAMPP Apache serves this checkout. Vite also denies environment files, and the
Cloudflare build excludes them from its assets.

```dotenv
BETTER_AUTH_URL=https://www.akmalalif.com
ADMIN_GITHUB_ID=44127834
BETTER_AUTH_SECRET=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
```

Initialize the generated secret without replacing existing values, and check key
presence without printing credentials:

```powershell
node scripts/admin-auth-secrets.mjs init
node scripts/admin-auth-secrets.mjs status
```

After copying an individual OAuth credential in the provider console, save it
without placing its value in shell arguments or output:

```powershell
Get-Clipboard -Raw | node scripts/admin-auth-secrets.mjs set GOOGLE_CLIENT_SECRET
```

Use the corresponding allowlisted key for each client ID or secret. The setter
rejects injected environment lines and preserves other root settings.
Copy Google's full client ID from the client details; its list view abbreviates
the ID. Storage and upload reject abbreviated IDs and credentials belonging to
the other provider.

Create a dedicated Google Web application and GitHub OAuth App named **Akmal Alif
Admin**. Set the homepage/origin to `https://www.akmalalif.com` and register:

| Provider | Production callback | Requested identity data |
| --- | --- | --- |
| Google | `https://www.akmalalif.com/api/auth/callback/google` | OpenID identity, email, profile |
| GitHub | `https://www.akmalalif.com/api/auth/callback/github` | User profile and `user:email` |

Google consent branding belongs to the dedicated portfolio project. If the app is
in testing, add the approved Google account as a test user. Keep repository access,
mailbox access, billing, and other projects outside these OAuth grants.

Upload only the five authentication credentials to the portfolio Worker's
encrypted runtime secrets:

```powershell
node scripts/admin-auth-secrets.mjs upload
```

The uploader selects an explicit allowlist and sends JSON to Wrangler through stdin.
It does not upload the other root environment values or change the existing gateway
secret. Runtime secrets remain outside public Nuxt configuration and static assets.

## Gateway and browser behavior

The root gateway removes caller-supplied identity, forwarded, authorization, cookie,
and Access headers. Authenticated requests receive the existing internal gateway
credential plus `x-portfolio-admin-id: root` and `x-portfolio-admin-email` containing
the canonical owner email. The admin service validates the credential, origin, and
owner markers. The session cookie is consumed by the portfolio Worker.

Login and the bundled static resources needed to render it are public. Unauthenticated
page navigation redirects to `/admin/login`; protected API calls return JSON `401`.
Write operations require the same origin. Successful sign-in returns to a validated
admin path; sign-out revokes the server session before clearing the dashboard state.

The existing `go.akmalalif.com` bearer/MCP interface, analytics ingestion, paired
judging devices, and opt-in localhost admin workflow keep their own boundaries.
The Vite preview at port 3000 continues to forward public reads only. Test auth
against an isolated local Worker with provider mocks rather than forwarding OAuth
writes to production from Vite.

For local browser QA through the portfolio Worker, set `ALLOW_LOCAL_AUTH=true`
and `ALLOW_LOCAL_ADMIN=false` on both Workers, use the same local gateway origin
for `BETTER_AUTH_URL` and `PORTFOLIO_ADMIN_ORIGIN`, and set
`NUXT_PUBLIC_ADMIN_ORIGIN` to that origin plus `NUXT_PUBLIC_ADMIN_GATEWAY=true`
on the admin Worker. The last flag opts the localhost client into gateway API
paths. Leave it unset when running the native admin service directly.

## Deployment and rollback

1. Save both deployed Worker versions and the existing Access application/policy.
2. Apply the additive auth migration to the portfolio database. Do not apply it to
   the admin database or run destructive schema reconciliation.
3. Configure provider callbacks and encrypted runtime secrets.
4. Deploy the compatible admin service first, then the portfolio authentication
   Worker. `ADMIN_AUTH_MODE=better-auth` selects the session gate; `access` is an
   explicit rollback mode, never an automatic fallback for missing OAuth settings.
5. Verify Google and GitHub callbacks and authenticated assets/API calls while the
   existing Access application still protects admin paths.
6. Apply a reversible Bypass/Everyone policy only to **Akmal Alif Admin**, retaining
   its original owner policy. Its destinations are `/admin`, `/admin/*`, `/api/admin`,
   and `/api/admin/*` on `www.akmalalif.com`.
7. Verify a fresh browser reaches Better Auth directly, both providers can use the
   dashboard, sign-out blocks further API requests, and public and machine flows
   still work. Disable the portfolio-specific Access runtime configuration after
   the cutover is proven.

If a cutover check fails, restore the Access owner policy before reverting Worker
versions or selecting Access mode. Retain the additive auth tables during rollback.

## Verification record

Record the exact Git commit, both Worker version IDs, migration status, provider
callback checks, fresh-browser tests, and desktop/mobile screenshots in private
release evidence under `.wrangler/auth-release/`. Mark tests or provider actions that
could not be completed explicitly; this runbook itself is not deployment evidence.
