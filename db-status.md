# DB Incident Handoff (chat-support)

Last updated: 2026-02-10 20:02:17 EST (2026-02-11T01:02:17Z)

## TL;DR

- Production sign-in is still failing because runtime DB auth is failing.
- Live endpoint confirms Prisma is still using `neondb_owner` credentials and getting `28P01`.
- Neon compute is now active and a new role was created: `chat-support-db-owner`.
- Vercel production DB env vars have **not** been switched to the new role yet.

## Current Production Evidence

Endpoint:

- `GET https://chat-support-azure.vercel.app/api/ops/db-status` (basic auth protected)
  - `ok: false`
  - selected source: `POSTGRES_PRISMA_URL (auto-selected Neon pooler host over APP_DATABASE_URL_PLUS_FALLBACK_CREDS)`
  - host: `ep-super-base-aipbnllc-pooler.c-4.us-east-1.aws.neon.tech`
  - Prisma error: `P2010` with Postgres `28P01` (`password authentication failed for user 'neondb_owner'`)

- `GET https://chat-support-azure.vercel.app/api/ops/db-status?mode=scan`
  - `APP_DATABASE_URL`: password missing
  - all passworded Neon URLs (`POSTGRES_PRISMA_URL`, `POSTGRES_URL`, `DATABASE_URL_UNPOOLED`, etc.) fail auth for `neondb_owner`
  - no candidate URL currently passes `SELECT 1`

## Infra State (User-Reported in Console)

- Neon branch: `main`
- endpoint: `ep-super-base-aipbnllc`
- compute: transitioned from `SUSPENDED/Idle` to `Active`
- new role created: `chat-support-db-owner`
- `neondb_owner` password reset flow in UI was unreliable (`cannot update password for role without password`)

## Code State in Repo

Local uncommitted files:

- `.gitignore` (pre-existing local change; includes `.vercel`)
- `lib/prisma.ts` (local patch added)

`lib/prisma.ts` patch intent:

- keeps `APP_DATABASE_URL*` candidates authoritative
- only auto-switches to Neon pooler URL when username/password/database identity matches
- prevents stale pooler credentials from overriding APP-derived URL

Validation run:

- `npm run typecheck` passed
- `npm run test -- tests-ts/auth-logic.test.ts` passed

## Attempted but Not Completed

- Tried updating Vercel env vars via CLI in-session.
- `vercel env rm`/batch update commands repeatedly hung.
- `vercel env ls` still shows DB vars with original creation timestamps (no confirmed rotation update).

## What the Next Agent Should Do

1. Get fresh connection strings from Neon `Connect` for role `chat-support-db-owner`:
   - pooling ON URL (pooler)
   - pooling OFF URL (direct)
2. Update Vercel **production** DB env vars to the new role/password:
   - `APP_DATABASE_URL`
   - `POSTGRES_PRISMA_URL`
   - `DATABASE_URL`
   - `POSTGRES_URL`
   - `DATABASE_URL_UNPOOLED`
   - `POSTGRES_URL_NON_POOLING`
   - `POSTGRES_URL_NO_SSL`
   - `PGHOST`, `POSTGRES_HOST`, `PGHOST_UNPOOLED`
   - `PGUSER`, `POSTGRES_USER`
   - `PGPASSWORD`, `POSTGRES_PASSWORD`
   - `PGDATABASE`, `POSTGRES_DATABASE`
3. Redeploy production.
4. Re-verify:
   - `/api/ops/db-status` should return `ok: true`
   - `/api/ops/db-status?mode=scan` should show at least one `ok: true`
5. Re-test sign-in flow with:
   - correct credentials => success redirect/session
   - wrong password => `CredentialsSignin`

## Recommended Vercel CLI Pattern (to avoid hanging)

Use force-overwrite instead of remove/add loops:

```bash
printf '%s\n' "$VALUE" | npx --yes vercel@latest env add KEY production --scope legertoms-projects --yes --force
```

Apply one key at a time if needed.

## Security Note

- A DB password appeared in screenshot context during debugging.
- Rotate DB credentials again after recovery and remove any temporary copies/logs.

