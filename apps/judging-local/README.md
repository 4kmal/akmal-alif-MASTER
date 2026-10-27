# SDC judging station

This loopback-only station uses the same review component and workbook calculations as `/admin/judging/sdc-2026`. Use Node **24.21.0** and pnpm **11.2.2**.

```powershell
pnpm --dir apps/judging-local install --frozen-lockfile
pnpm dev:judging
```

Open `http://127.0.0.1:8791`. The source workbook must already be in `events/judging/sdcHackathon/sources/`. The workspace defaults to `C:/xampp/htdocs/akmal-alif-MASTER/events/judging/sdcHackathon`; `JUDGING_WORKSPACE` can select a separate test workspace and `JUDGING_PORT` can select its port.

## Evidence and scoring

Run intake from the dashboard or `pnpm --dir apps/judging-local intake`. Intake freezes and verifies repository commits, hashes artifacts and extracts selected text. It never installs or runs participant applications. Repeated intake reuses verified snapshots; changed commits create new snapshots.

Repository access, deployment HTTP checks and observed demo parity are separate. Demo claims remain unverified until the judge inspects them. AI drafts contain evidence citations; accepting a draft only fills editable fields. A judge must explicitly approve every reviewed result.

Private data, raw clones and exports stay in the ignored judging workspace. Windows permissions restrict it to the current user and SYSTEM. The browser receives selected text, never arbitrary filesystem paths or participant HTML execution.

## Pairing and sync

In the authenticated admin page, create a ten-minute single-use pairing code, then enter it in the local station. The resulting seven-day credential is stored in `data/device-credential.json`, outside Git and browser storage. Revoke it from the admin device list when finished.

Edits save to local SQLite and enter an offline outbox. While active, sync runs every ten seconds. Version conflicts require choosing between the local and cloud records. Keep this process running for browser edits to persist; reconnecting drains pending work without replacing frozen repositories.

## Exports

Draft exports are progress backups. Final export requires all nine reviews, judge details and warning acknowledgements. Export modifies a copy of the original workbook and preserves its Guide, formulas, hyperlinks and formatting. The organizer form upload is a manual judge action.

```powershell
pnpm --dir apps/judging-local test
pnpm --dir apps/judging-local build
pnpm --dir apps/admin test
```
