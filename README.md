# Support Clever RAG Scraper

A robust, incremental scraper + data prep pipeline for Clever docs. It can scrape `support.clever.com`, `dev.clever.com`, or both, then fetch content (HTTP + Playwright fallback), extract clean article content + metadata, and produce canonical JSONL plus chunked JSONL for RAG.

## Features

- Discovery via sitemap, category crawl, optional search, and fallback crawl
- HTTP fetch with conditional requests; Playwright fallback for JS/auth
- Resilient extraction with multi-selector + heuristic fallback
- Normalized Markdown + plain text output
- Chunking by semantic structure (headings, lists, steps)
- Incremental caching (SQLite) with resume support
- Polite crawling (rate limit, concurrency, robots.txt)
- Structured logs + manifest + error capture
- Source toggles (`support`, `dev`) for discovery/scrape and retrieval context

## Setup

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m playwright install
```

Ensure the package is on your Python path:

```bash
export PYTHONPATH=src
```

Copy the config and adjust as needed:

```bash
cp config.example.yaml config.yaml
```

## Usage

You can run via Python directly:

```bash
PYTHONPATH=src python -m support_scraper discover
PYTHONPATH=src python -m support_scraper discover --sources=support,dev
PYTHONPATH=src python -m support_scraper scrape --use-playwright=auto --concurrency=4 --rate-limit=1.5 --save-raw-html
PYTHONPATH=src python -m support_scraper scrape --sources=dev
PYTHONPATH=src python -m support_scraper chunk
PYTHONPATH=src python -m support_scraper run-all
PYTHONPATH=src python -m support_scraper validate
```

Or via npm scripts (mapped to the Python CLI):

```bash
npm run discover
npm run discover -- --sources=support,dev
npm run scrape -- --use-playwright=auto --concurrency=4 --rate-limit=1.5 --save-raw-html
npm run scrape -- --sources=dev
npm run chunk
npm run run-all
```

## Outputs

All outputs are stored in `data/`:

- `articles.jsonl` — canonical article records (one JSON per line)
- `chunks.jsonl` — chunked records for vector indexing
- `manifest.json` — summary counts, durations, warnings
- `errors.jsonl` — per-URL failures
- `urls.json` — discovered article URLs
- `raw_html/` — raw HTML snapshots (optional)
- `screenshots/` — Playwright screenshots on error (optional)

## Canonical Article Schema

```json
{
  "doc_id": "support-clever:<stable-id>",
  "url": "<canonical-url>",
  "title": "<article title>",
  "updated_at": "<ISO8601 or null>",
  "published_at": "<ISO8601 or null>",
  "breadcrumbs": ["<category>", "..."],
  "tags": ["<tag>", "..."],
  "summary": "<short description if present>",
  "body_markdown": "<clean normalized markdown>",
  "body_text": "<plain text version>",
  "attachments": [{"name":"...", "url":"..."}],
  "related_links": [{"label":"...", "url":"..."}],
  "source": "support",
  "source_host": "support.clever.com",
  "scraped_at": "<ISO8601 timestamp>",
  "content_hash": "<hash of normalized markdown + title + updated_at>",
  "raw_html_path": "<path or null>"
}
```

## Chunk Schema

```json
{
  "chunk_id": "support-clever:<stable-id>#<chunk-index-or-section>",
  "doc_id": "support-clever:<stable-id>",
  "url": "<canonical-url>",
  "title": "<article title>",
  "heading_path": ["<title>", "<H2>", "<H3>"],
  "section": "<best section label>",
  "text": "<chunk text with structure preserved>",
  "tokens_estimate": 123,
  "updated_at": "<ISO8601 or null>",
  "breadcrumbs": ["..."],
  "tags": ["..."],
  "source": "support",
  "source_host": "support.clever.com",
  "scraped_at": "<ISO8601 timestamp>",
  "content_hash": "<same as parent or chunk hash>"
}
```

## How Extraction Works

1. **Selectors first**: tries a list of known Knowledge/Experience Cloud selectors (`article`, `data-aura-class*='knowledge'`, `.forceCommunityArticleDetail`, `.slds-rich-text-editor__output`, `.knowledgeArticle`).
2. **Heuristic fallback**: scores candidate nodes by text density, headings/lists, link density penalties, and title proximity.
3. **Cleanup**: removes navigation, footers, feedback widgets, and related-articles carousels.
4. **Normalization**: converts to Markdown with consistent headings, lists, callouts, tables, and absolute links.
5. **Validation**: enforces minimum content length and non-empty title.

## Authentication (if needed)

If the site requires authentication:

1. Configure the Playwright login block in `config.yaml`.
2. Export credentials in environment variables:

```bash
export SUPPORT_USER="you@example.com"
export SUPPORT_PASS="your_password"
```

3. Run once to generate `storage_state_path` (configured in `config.yaml`):

```bash
python -m support_scraper scrape --use-playwright=true --max-urls=1
```

Subsequent runs will reuse the stored session.

## Automated Weekly Scrape + Admin Rescrape (GitHub Actions)

This repo includes `.github/workflows/scrape-support-data.yml` for low-maintenance refreshes.

What it does:

- Runs weekly on Monday at `09:00 UTC`.
- Uses `run-all --resume` by default to keep weekly runs fast.
- Supports manual runs from the Actions UI with inputs:
  - `full_rescrape=true` to clear cached artifacts and rebuild from scratch.
  - `config_file` (`config.auth.yaml`, `config.public.yaml`, or `config.yaml`).
  - `max_urls` for ad-hoc capped runs.
- Commits updated artifacts back to the repo:
  - `data/articles.jsonl`
  - `data/chunks.jsonl`
  - `data/urls.json`
  - `data/manifest.json`
  - `data/errors.jsonl`
  - `data/cache.sqlite`

Setup steps:

1. Push this repository to GitHub.
2. Add Actions secrets in repository settings:
   - `SUPPORT_USER`
   - `SUPPORT_PASS`
3. Keep workflow permissions enabled so Actions can push data updates (`contents: write` is already configured in the workflow).

Manual admin rescrape:

1. Go to **GitHub → Actions → Scrape Support Data → Run workflow**.
2. Set `full_rescrape` to `true` when you want a full rebuild.
3. Choose `config_file` and optional `max_urls`, then run.

`workflow_dispatch` runs are available only to users with write/admin repository access.

## Notes

- By default the scraper respects `robots.txt`; override with `obey_robots: false`.
- If the discovery count is far below ~450, inspect `data/urls.json` and tweak discovery settings.
- Use `--sources=support`, `--sources=dev`, or `--sources=support,dev` to control which sources are included.

## Web App V1 (Auth + Persistence + Admin)

The Next.js app now ships as a production-oriented V1 for internal prelaunch testing and staged rollout.

### Stack

- Next.js App Router + TypeScript
- Auth.js (Google OAuth + optional local credentials)
- Prisma ORM + PostgreSQL (Supabase-compatible)
- In-app API routes under `app/api/*`
- Existing Python scraper/data pipeline remains unchanged

### Local setup (web app)

1. Install Node dependencies:

```bash
npm install
```

2. Copy env template:

```bash
cp .env.example .env
```

3. Configure required env vars:

- `DATABASE_URL`
- `AUTH_SECRET`
- One sign-in method:
  - Google OAuth: `AUTH_GOOGLE_ID` + `AUTH_GOOGLE_SECRET`
  - Local credentials: `BASIC_AUTH_USERNAME` + `BASIC_AUTH_PASSWORD`
- Optional for local credentials: `BASIC_AUTH_EMAIL`, `BASIC_AUTH_ROLE` (`admin` or `member`)
- `DEFAULT_STARTING_CREDIT_CENTS` (default `200`)
- `INITIAL_ADMIN_EMAILS` (comma-separated)
- model provider key(s), for example `OPENAI_API_KEY`
- BYOK encryption variables:
  - `USER_API_KEYS_ENCRYPTION_KEY` (required outside `NODE_ENV=development`): 32-byte key encoded as base64/base64url or 64-char hex
  - `USER_API_KEYS_ENCRYPTION_KEY_ID` (required outside `NODE_ENV=development`): active key identifier (for example `primary-2026-02`)
  - optional `USER_API_KEYS_DECRYPTION_KEYRING` for decrypting older `v2` payloads during rotation (`keyId=key,keyId=key`)
  - optional `USER_API_KEYS_LEGACY_DECRYPTION_SECRETS` for temporary `v1` compatibility during migration

4. Generate Prisma client and apply migrations:

```bash
npm run prisma:generate
npx prisma migrate dev --name init_v1
```

5. Run dev server:

```bash
npm run dev
```

### BYOK security defaults

- Personal API keys are encrypted with AES-256-GCM using `USER_API_KEYS_ENCRYPTION_KEY`.
- Auth/session secrets are no longer used as BYOK encryption fallback.
- Stored key payloads are versioned and key-tagged (`v2:<key-id>:...`).
- Legacy `v1` payloads can still be decrypted (when compatible secrets are configured) and are automatically re-encrypted to `v2` on use/update.
- Personal key previews are suffix-only masked (`********1234`), without key prefixes.
- Key management endpoints (`/api/me/keys*`) enforce ownership checks, per-user rate limiting, and provider-change guardrails.
- BYOK lifecycle/use actions emit structured audit events (`create`, `update`, `delete`, `use`) with request correlation IDs when available.
- Client-visible non-API errors are sanitized to avoid leaking internals.
- Gemini provider calls and model discovery use header-based API key auth (no key query parameters).

### BYOK migration endpoint

- Admin endpoint: `POST /api/admin/security/byok/migrate`
- Default mode is dry-run when request body is omitted/empty.
- Request body fields:
  - `dryRun` (boolean, default `true`)
  - `limit` (int, default `250`, max `1000`)
  - `userId` (optional, scope migration to one user)
- Response includes `scanned`, `needsReencrypt`, `updated`, `failed`, `requestId`.

See `docs/BYOK_SECURITY_RUNBOOK.md` for key rotation, rollback, incident response, and deployment order.

### Database model

Prisma schema is in `prisma/schema.prisma` and includes:

- `User`, `Account`, `Session`, `VerificationToken`
- `Invite`
- `Wallet`, `WalletLedger`
- `Thread`, `ThreadParticipant`, `Message`, `MessageCitation`
- `MessageFeedback`, `ThreadFeedback`
- `RetrievalSignal`
- `IngestionCandidate`
- `AdminAuditLog`

Migration scaffold is in `prisma/migrations/20260209090000_init_v1/migration.sql`.

### Auth and access policy

Google-only sign in via Auth.js callback logic:

- Email is required and must be `email_verified=true`.
- Verified `@clever.com` users are allowed automatically.
- External domains (including `gmail.com`) require an active, unexpired invite for exact email.
- Disabled users are blocked.

On first successful login:

- User record is provisioned/updated.
- Role is set from invite role when applicable.
- Users listed in `INITIAL_ADMIN_EMAILS` are elevated to admin.
- Wallet is auto-created with default or invite credit.
- Invite is marked accepted.

### Collaboration and retention

- Threads/messages are persisted in PostgreSQL.
- Thread visibility defaults to `org` (shared).
- UI supports scope filter: `All` vs `Mine`.
- Users can reopen and continue threads.
- Queries and assistant responses are retained.

### Budget controls

Budget is enforced on every `/api/chat` call:

1. Estimate worst-case turn cost from prompt + `maxOutputTokens` + model pricing.
2. If wallet balance is below estimate, return `402 insufficient_balance`.
3. Reserve estimated amount (wallet decrement + reservation ledger entry).
4. Execute provider call.
5. Compute actual cost from returned usage and pricing.
6. Finalize atomically:
   - debit actual amount
   - release unused reservation
   - write ledger entries

Notes:

- Monetary storage is integer cents.
- Turn usage and measured USD are also retained in message usage metadata.
- Remaining balance is returned in chat response.

### Feedback and retrieval weighting

Users can submit:

- per-assistant-message rating/comment
- per-thread rating/comment

These updates feed `RetrievalSignal` stats used as conservative score multipliers for chunk ranking.

Weighting formula (implemented in `lib/retrieval-weighting.ts`):

- Base signal from average rating around neutral 3.0
- Confidence scaling by sample count
- Additional low/high rating ratio adjustment
- Clamp multiplier to `[0.7, 1.2]`

Behavioral constraints:

- Poorly rated chunks are de-emphasized, not removed.
- High-rated interactions create `IngestionCandidate` records.
- No auto-ingestion; admin must approve/reject candidates.

### Admin operations

Admin UI: `/admin`

Admin APIs support:

- User listing + role/status changes
- Credit top-ups
- Invite create/list/revoke/resend
- Ingestion candidate review (approve/reject)
- Audit logging for admin actions

### API surface (web app)

Core:

- `POST /api/chat`
- `GET /api/threads?scope=all|mine&cursor=...`
- `POST /api/threads`
- `GET /api/threads/:id`
- `POST /api/threads/:id/messages`
- `POST /api/messages/:id/feedback`
- `POST /api/threads/:id/feedback`

Admin:

- `GET /api/admin/users`
- `PATCH /api/admin/users/:id`
- `POST /api/admin/users/:id/credit`
- `POST /api/admin/invites`
- `GET /api/admin/invites`
- `PATCH /api/admin/invites/:id`
- `GET /api/admin/ingestion-candidates`
- `PATCH /api/admin/ingestion-candidates/:id`

All write endpoints use strict Zod validation.

### Testing and checks

Web app:

```bash
npm run typecheck
npm run test
npm run build
```

Scraper pipeline:

```bash
.venv/bin/python -m pytest
```

### Vercel rollout notes

#### Hobby (prelaunch testing)

- Suitable for low-concurrency internal validation.
- Use managed Postgres (for example Supabase) and set all env vars in Vercel project settings.
- Keep `INITIAL_ADMIN_EMAILS` limited.

#### Pro (launch)

- Recommended for higher concurrency and operational reliability.
- Add monitoring/alerts for wallet debits, 402 rates, and provider failures.
- Use production Postgres with backups and audit retention policy.

### Safety and retention notes

- Chat content, feedback, and audit logs are retained in DB by design.
- Avoid posting secrets or sensitive personal data in prompts.
- Ingestion candidates are staged only; admin review is mandatory before any downstream ingestion step.
