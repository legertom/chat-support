#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

CONFIG_FILE="${SCRAPER_CONFIG:-config.public.yaml}"
MODE="${1:-all}"

USE_PLAYWRIGHT="${USE_PLAYWRIGHT:-true}"
CONCURRENCY="${CONCURRENCY:-2}"
RATE_LIMIT="${RATE_LIMIT:-1.0}"
MAX_URLS="${MAX_URLS:-}"

if [[ ! -d ".venv" ]]; then
  echo "Missing .venv. Run: python -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt"
  exit 1
fi

if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "Config not found: $CONFIG_FILE"
  echo "Set SCRAPER_CONFIG or create the file in $ROOT_DIR"
  exit 1
fi

source ".venv/bin/activate"
export PYTHONPATH=src

run_discover() {
  local cmd=(python -m support_scraper discover --config "$CONFIG_FILE" "--use-playwright=$USE_PLAYWRIGHT")
  if [[ -n "$MAX_URLS" ]]; then
    cmd+=("--max-urls=$MAX_URLS")
  fi
  "${cmd[@]}"
}

run_scrape() {
  local cmd=(python -m support_scraper scrape --config "$CONFIG_FILE" "--use-playwright=$USE_PLAYWRIGHT" "--concurrency=$CONCURRENCY" "--rate-limit=$RATE_LIMIT")
  if [[ -n "$MAX_URLS" ]]; then
    cmd+=("--max-urls=$MAX_URLS")
  fi
  if [[ "$1" == "resume" ]]; then
    cmd+=(--resume)
  fi
  "${cmd[@]}"
}

run_chunk() {
  python -m support_scraper chunk --config "$CONFIG_FILE"
}

run_validate() {
  python -m support_scraper validate --config "$CONFIG_FILE"
}

case "$MODE" in
  all)
    run_discover
    run_scrape normal
    run_chunk
    run_validate
    ;;
  resume)
    run_scrape resume
    run_chunk
    run_validate
    ;;
  discover)
    run_discover
    ;;
  scrape)
    run_scrape normal
    ;;
  chunk)
    run_chunk
    ;;
  validate)
    run_validate
    ;;
  *)
    echo "Usage: ./run_scraper.sh [all|resume|discover|scrape|chunk|validate]"
    echo "Env knobs: SCRAPER_CONFIG, USE_PLAYWRIGHT, CONCURRENCY, RATE_LIMIT, MAX_URLS"
    exit 1
    ;;
esac
