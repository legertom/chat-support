import hashlib
import json
import os
import random
import re
import time
from datetime import datetime, timezone
from typing import Iterable, List, Optional
from urllib.parse import urljoin, urlparse, urlunparse, parse_qsl, urlencode

TRACKING_PARAMS_PREFIXES = (
    "utm_",
)
TRACKING_PARAMS = {
    "gclid",
    "fbclid",
    "mc_cid",
    "mc_eid",
}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def normalize_url(url: str, base_url: Optional[str] = None) -> str:
    if base_url:
        url = urljoin(base_url, url)
    parsed = urlparse(url)
    if not parsed.scheme:
        parsed = urlparse("https://" + url)
    # Strip fragments
    parsed = parsed._replace(fragment="")
    # Remove tracking params
    query_params = []
    for key, value in parse_qsl(parsed.query, keep_blank_values=True):
        if key in TRACKING_PARAMS:
            continue
        if any(key.startswith(prefix) for prefix in TRACKING_PARAMS_PREFIXES):
            continue
        query_params.append((key, value))
    query = urlencode(query_params, doseq=True)
    parsed = parsed._replace(query=query)
    # Normalize trailing slash (keep root)
    path = parsed.path or "/"
    if path != "/" and path.endswith("/"):
        path = path[:-1]
    parsed = parsed._replace(path=path)
    return urlunparse(parsed)


def is_same_domain(url: str, base_url: str) -> bool:
    return urlparse(url).netloc.lower() == urlparse(base_url).netloc.lower()


def absolute_url(url: str, base_url: str) -> str:
    return normalize_url(urljoin(base_url, url))


def safe_filename(text: str) -> str:
    safe = re.sub(r"[^a-zA-Z0-9._-]+", "_", text)
    return safe.strip("_") or "file"


def write_json(path: str, data) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def read_json(path: str):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def read_jsonl(path: str) -> List[dict]:
    items = []
    if not os.path.exists(path):
        return items
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            items.append(json.loads(line))
    return items


def write_jsonl(path: str, items: Iterable[dict]) -> None:
    with open(path, "w", encoding="utf-8") as f:
        for item in items:
            f.write(json.dumps(item, ensure_ascii=False))
            f.write("\n")


def append_jsonl(path: str, item: dict) -> None:
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(item, ensure_ascii=False))
        f.write("\n")


def ensure_dir(path: str) -> None:
    os.makedirs(path, exist_ok=True)


def estimate_tokens(text: str) -> int:
    # Rough heuristic: 1 token ~= 4 chars
    if not text:
        return 0
    return max(1, int(len(text) / 4))


def jitter_delay(base_seconds: float, jitter_ratio: float = 0.1) -> float:
    return base_seconds + random.uniform(0, base_seconds * jitter_ratio)


def normalize_whitespace(text: str) -> str:
    text = re.sub(r"\r\n", "\n", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def strip_markdown(md: str) -> str:
    # Remove code fences
    md = re.sub(r"```[\s\S]*?```", " ", md)
    # Remove inline code
    md = re.sub(r"`([^`]+)`", r"\1", md)
    # Remove images
    md = re.sub(r"!\[[^\]]*\]\([^\)]+\)", " ", md)
    # Replace links [text](url) with text
    md = re.sub(r"\[([^\]]+)\]\([^\)]+\)", r"\1", md)
    # Strip markdown headings/bullets
    md = re.sub(r"^#+\s+", "", md, flags=re.MULTILINE)
    md = re.sub(r"^\s*[-*+]\s+", "", md, flags=re.MULTILINE)
    md = re.sub(r"^\s*\d+\.\s+", "", md, flags=re.MULTILINE)
    return normalize_whitespace(md)


def chunked(iterable: List[str], n: int) -> Iterable[List[str]]:
    for i in range(0, len(iterable), n):
        yield iterable[i : i + n]


def sleep(seconds: float) -> None:
    time.sleep(seconds)
