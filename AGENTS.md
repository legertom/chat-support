# AGENTS.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## What this repo is
A Python-based, incremental scraper + data-prep pipeline for `support.clever.com` that produces:
- `data/articles.jsonl` (canonical article records)
- `data/chunks.jsonl` (RAG-ready chunks)
- `data/cache.sqlite` (resume + conditional request metadata)

The main entrypoint is the Python module CLI: `python -m support_scraper ...` (implemented in `src/support_scraper/cli.py`).

## Setup
Create a venv, install deps, and install Playwright browsers:
```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m playwright install
```

Config:
```bash
cp config.example.yaml config.yaml
```

## Common commands
You can run the pipeline either via Python directly or via `npm` scripts (which set `PYTHONPATH=src` for you).

### Discover article URLs
```bash
PYTHONPATH=src python -m support_scraper discover
# or
npm run discover
```
Output: `data/urls.json`.

### Scrape articles
```bash
PYTHONPATH=src python -m support_scraper scrape
# or
npm run scrape
```
Pass flags through `npm` with `--`:
```bash
npm run scrape -- --use-playwright=auto --concurrency=4 --rate-limit=1.5 --save-raw-html
```
Useful flags (see `src/support_scraper/cli.py`):
- `--resume` (skip URLs already marked success in cache, if the article record exists)
- `--concurrency=N`
- `--rate-limit=RPS`
- `--use-playwright=true|false|auto`
- `--save-raw-html` / `--save-screenshots`
- `--max-urls=N`

### Chunk scraped articles for RAG
```bash
PYTHONPATH=src python -m support_scraper chunk
# or
npm run chunk
```
Output: `data/chunks.jsonl`.

### Run discover + scrape + chunk
```bash
PYTHONPATH=src python -m support_scraper run-all
# or
npm run run-all
```

### Validate outputs
```bash
PYTHONPATH=src python -m support_scraper validate
# or
npm run validate
```

## Tests
Tests are written for `pytest` (see `tests/`). If `pytest` isn’t installed in your environment, install it (e.g. `pip install pytest`).

Run all tests:
```bash
python -m pytest
```

Run a single file:
```bash
python -m pytest tests/test_extractor.py
```

Run a single test:
```bash
python -m pytest tests/test_extractor.py::test_extract_article_basic_fields
```

## High-level architecture
The pipeline is intentionally split into small modules with a single responsibility:

### CLI orchestration (`src/support_scraper/cli.py`)
Defines subcommands:
- `discover` → URL discovery
- `scrape` → fetch + extract + write `articles.jsonl` (incremental)
- `chunk` → convert articles → chunks
- `run-all` → discover + scrape + chunk
- `validate` → sanity-check outputs and print a summary

CLI loads YAML config via `src/support_scraper/config.py` and applies flag overrides.

### URL discovery (`src/support_scraper/discovery.py`)
Finds article URLs using several strategies:
1) `sitemap.xml` (and nested sitemaps)
2) crawl category pages under configured paths (defaults to `/s/`)
3) optional search endpoint (config-gated)
4) fallback crawl if discovery results are very small

All URLs are normalized (tracking params stripped, fragments removed) via `src/support_scraper/utils.py`.

### Scraping + incrementality (`src/support_scraper/scraper.py`)
Core loop:
- Optionally consult `robots.txt` (`src/support_scraper/robots.py`) and rate-limit requests (`src/support_scraper/rate_limiter.py`).
- Fetch HTML using `HttpFetcher` first (`src/support_scraper/fetcher.py`), with conditional requests (ETag/Last-Modified) when an article is already present.
- If blocked/auth/captcha is detected, optionally fall back to `PlaywrightFetcher` (also in `fetcher.py`).
- Extract a canonical article record (`src/support_scraper/extractor.py`) and write/update `data/articles.jsonl`.
- Maintain per-URL state in SQLite (`src/support_scraper/cache.py`) to support `--resume` and “not modified” skipping.

### Extraction + normalization (`src/support_scraper/extractor.py`, `src/support_scraper/normalizer.py`)
- Selects the “best” article body by CSS selectors first, then a text-density heuristic.
- Removes nav/footers/widgets using configured selectors.
- Normalizes HTML → Markdown (headings/lists/callouts/tables; absolute links).
- Produces `doc_id` using a Salesforce Knowledge article id if found, else a hash of the canonical URL.

### Chunking for RAG (`src/support_scraper/chunker.py`)
- Splits normalized markdown into sections based on headings.
- Splits sections into token-bounded chunks (token estimate is a rough heuristic).
- Merges very small chunks with neighbors and reindexes chunk ids.

### Authentication (Playwright)
If the site requires login, Playwright can be configured via `config.yaml` (`playwright.login.*`). Credentials are read from env vars (defaults: `SUPPORT_USER` / `SUPPORT_PASS`). See `src/support_scraper/fetcher.py` and the README’s “Authentication” section.