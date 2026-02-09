# Support Clever RAG Scraper

A robust, incremental scraper + data prep pipeline for support.clever.com (Salesforce Experience Cloud / Knowledge). It discovers article URLs, fetches content (HTTP + Playwright fallback), extracts clean article content + metadata, and produces canonical JSONL plus chunked JSONL for RAG.

## Features

- Discovery via sitemap, category crawl, optional search, and fallback crawl
- HTTP fetch with conditional requests; Playwright fallback for JS/auth
- Resilient extraction with multi-selector + heuristic fallback
- Normalized Markdown + plain text output
- Chunking by semantic structure (headings, lists, steps)
- Incremental caching (SQLite) with resume support
- Polite crawling (rate limit, concurrency, robots.txt)
- Structured logs + manifest + error capture

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
PYTHONPATH=src python -m support_scraper scrape --use-playwright=auto --concurrency=4 --rate-limit=1.5 --save-raw-html
PYTHONPATH=src python -m support_scraper chunk
PYTHONPATH=src python -m support_scraper run-all
PYTHONPATH=src python -m support_scraper validate
```

Or via npm scripts (mapped to the Python CLI):

```bash
npm run discover
npm run scrape -- --use-playwright=auto --concurrency=4 --rate-limit=1.5 --save-raw-html
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
  "source": "support.clever.com",
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

## Notes

- By default the scraper respects `robots.txt`; override with `obey_robots: false`.
- If the discovery count is far below ~450, inspect `data/urls.json` and tweak discovery settings.

## Frontend RAG Lab (New)

This repo now includes a Next.js app that sits directly on top of your local `data/chunks.jsonl` and provides:

- Multi-model chat with OpenAI, Anthropic (Opus/Sonnet/Haiku), and Gemini
- Retrieval-Augmented Generation (RAG) from local Clever support chunks
- Source links/snippets for each answer
- Per-response token usage + USD cost
- Thread-level token and cost totals
- Local API key override in the UI (stored in browser local storage)

### App architecture

- UI: `app/page.tsx` + `components/rag-lab.tsx`
- API route: `app/api/chat/route.ts`
- Retrieval: `lib/retrieval.ts` (in-memory BM25-style lexical ranking over `data/chunks.jsonl`)
- Provider adapters: `lib/providers.ts`
- Model catalog + pricing: `lib/models.ts`
- Dataset/model metadata: `app/api/stats/route.ts`

### Local run

Install Node deps:

```bash
npm install
```

Optional env file:

```bash
cp .env.example .env.local
```

Run:

```bash
npm run dev
```

Open `http://localhost:3000` (or the port shown by Next.js if `3000` is in use).

### API key options

Recommended production mode is server-side keys only:

- Set provider keys as env vars (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` or `GOOGLE_API_KEY`)
- Keep `ALLOW_CLIENT_API_KEY_OVERRIDE=false`
- Keep `NEXT_PUBLIC_ALLOW_CLIENT_API_KEY_OVERRIDE=false`

If you want to allow temporary user-supplied keys in the browser UI, set both override vars above to `true`.

### Simple auth protection (Basic Auth)

To add a lightweight username/password gate in front of both the app and API routes, set:

- `BASIC_AUTH_USERNAME=<your-username>`
- `BASIC_AUTH_PASSWORD=<your-password>`

If both vars are set, the app requires HTTP Basic Auth before any page/API access.
If both are blank, auth is disabled.

If no key is available for the selected provider, `/api/chat` returns a clear error message.

### Deployment (Vercel)

1. Push this repo to GitHub.
2. Import into Vercel.
3. Set framework preset to Next.js (auto-detected).
4. Set env vars:
   - Provider key(s): at least one of `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`/`GOOGLE_API_KEY`
   - Basic auth: `BASIC_AUTH_USERNAME`, `BASIC_AUTH_PASSWORD`
   - Server-only key mode: `ALLOW_CLIENT_API_KEY_OVERRIDE=false`, `NEXT_PUBLIC_ALLOW_CLIENT_API_KEY_OVERRIDE=false`
5. Build command: `npm run build` (default works).
6. Deploy.

Because the local dataset is in `data/chunks.jsonl`, it deploys with the app as long as that file is in the repo.

### Deployment (Railway)

1. Create a new Railway project from this repo.
2. Set env vars:
   - Provider key(s): at least one of `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`/`GOOGLE_API_KEY`
   - Basic auth: `BASIC_AUTH_USERNAME`, `BASIC_AUTH_PASSWORD`
   - Server-only key mode: `ALLOW_CLIENT_API_KEY_OVERRIDE=false`, `NEXT_PUBLIC_ALLOW_CLIENT_API_KEY_OVERRIDE=false`
3. Use:
   - Build command: `npm run build`
   - Start command: `npm run start`
4. Deploy and open the generated URL.

### Pricing assumptions used by the app

Pricing is model-specific and implemented in `lib/models.ts`. Cost = input token cost + output token cost using the API-reported usage counts.

Current presets (as of **2026-02-08**):

- OpenAI GPT-5: input `$1.25` / 1M, output `$10.00` / 1M
- OpenAI GPT-5 mini: input `$0.25` / 1M, output `$2.00` / 1M
- OpenAI GPT-5 nano: input `$0.05` / 1M, output `$0.40` / 1M
- Claude Opus 4.6: input `$5.00` / 1M, output `$25.00` / 1M (higher tier over 200K prompt tokens)
- Claude Sonnet 4.5: input `$3.00` / 1M, output `$15.00` / 1M (higher tier over 200K prompt tokens)
- Claude Haiku 4.5: input `$1.00` / 1M, output `$5.00` / 1M
- Gemini 2.5 Pro: input `$1.25` / 1M, output `$10.00` / 1M (higher tier over 200K prompt tokens)
- Gemini 2.5 Flash: input `$0.30` / 1M, output `$2.50` / 1M
- Gemini 2.5 Flash-Lite: input `$0.10` / 1M, output `$0.40` / 1M

Sources:

- OpenAI: https://openai.com/api/pricing/
- Anthropic: https://docs.anthropic.com/en/docs/about-claude/models/overview
- Gemini: https://ai.google.dev/gemini-api/docs/pricing

### What your current local dataset enables (and limits)

Given your current scrape (`494` articles, `1487` chunks):

- Opportunity: the full Clever support corpus is small enough to load in-memory quickly, which keeps local testing and serverless deployment simple.
- Opportunity: each response can include direct support article links with no external vector DB.
- Limitation: retrieval is lexical (BM25-style), so semantic matches with very different wording can be missed.
- Limitation: some chunks include scraper artifacts (e.g., quote markers and repeated boilerplate), which can dilute ranking quality.
- Limitation: no long-term chat memory or user analytics yet; this is session-scoped experimentation.

If quality plateaus, next upgrades are embedding retrieval + reranking, and optional query rewriting before retrieval.
