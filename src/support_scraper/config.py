import os
from copy import deepcopy
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple
from urllib.parse import urlparse

import yaml

REQUIRED_PATH_KEYS: Iterable[str] = (
    "data_dir",
    "urls_path",
    "articles_path",
    "chunks_path",
    "errors_path",
    "manifest_path",
    "cache_path",
    "raw_html_dir",
    "screenshots_dir",
)

DEFAULT_SUPPORT_ARTICLE_DISCOVERY: Dict[str, Any] = {
    "article_url_patterns": ["/s/articles/", "/s/article/", "/article/"],
    "category_paths": ["/s/"],
    "search": {
        "enabled": False,
        "endpoint": None,
        "query_param": "q",
        "page_param": "page",
        "page_start": 0,
        "page_size": 50,
    },
}

DEFAULT_DEV_ARTICLE_DISCOVERY: Dict[str, Any] = {
    "article_url_patterns": ["/docs/", "/reference/", "/api/"],
    "category_paths": ["/docs/"],
    "search": {
        "enabled": False,
        "endpoint": None,
        "query_param": "q",
        "page_param": "page",
        "page_start": 0,
        "page_size": 50,
    },
}

DEFAULT_SOURCES: Dict[str, Dict[str, Any]] = {
    "support": {
        "enabled": True,
        "base_url": "https://support.clever.com",
        "article_discovery": deepcopy(DEFAULT_SUPPORT_ARTICLE_DISCOVERY),
    },
    "dev": {
        "enabled": False,
        "base_url": "https://dev.clever.com",
        "article_discovery": deepcopy(DEFAULT_DEV_ARTICLE_DISCOVERY),
    },
}

DEFAULT_CONFIG: Dict[str, Any] = {
    "base_url": "https://support.clever.com",
    "user_agent": "SupportCleverRAGScraper/1.0 (+https://support.clever.com)",
    "rate_limit_rps": 1.5,
    "concurrency": 4,
    "obey_robots": True,
    "use_playwright": "auto",
    "save_raw_html": False,
    "save_screenshots": False,
    "max_urls": None,
    "paths": {
        "data_dir": "data",
        "urls_path": "data/urls.json",
        "articles_path": "data/articles.jsonl",
        "chunks_path": "data/chunks.jsonl",
        "errors_path": "data/errors.jsonl",
        "manifest_path": "data/manifest.json",
        "cache_path": "data/cache.sqlite",
        "raw_html_dir": "data/raw_html",
        "screenshots_dir": "data/screenshots",
    },
    "robots": {"allow_override": False},
    "fetch": {
        "timeout_seconds": 30,
        "retries": 3,
        "backoff_base": 1.5,
        "backoff_max_seconds": 30,
        "headers": {},
        "cookies": {},
    },
    "playwright": {
        "storage_state_path": None,
        "login": {
            "enabled": False,
            "login_url": None,
            "username_selector": None,
            "password_selector": None,
            "submit_selector": None,
            "username_env": "SUPPORT_USER",
            "password_env": "SUPPORT_PASS",
        },
    },
    "article_discovery": deepcopy(DEFAULT_SUPPORT_ARTICLE_DISCOVERY),
    "sources": deepcopy(DEFAULT_SOURCES),
    "extraction": {
        "min_body_chars": 500,
        "selectors": [
            "article",
            "[data-aura-class*='knowledge']",
            ".forceCommunityArticleDetail",
            ".slds-rich-text-editor__output",
            ".knowledgeArticle",
        ],
        "remove_selectors": [
            "nav",
            "header",
            "footer",
            "aside",
            "script",
            "style",
            ".slds-breadcrumb",
            ".breadcrumbs",
            ".helpful",
            ".feedback",
            ".survey",
            ".related",
            ".article-related",
            ".vote",
        ],
    },
    "chunking": {"target_tokens": 350, "min_tokens": 200, "max_tokens": 500},
}


def _merge_dicts(base: Dict[str, Any], override: Dict[str, Any]) -> Dict[str, Any]:
    merged = deepcopy(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _merge_dicts(merged[key], value)
        else:
            merged[key] = value
    return merged


def _normalize_sources(config: Dict[str, Any], loaded_has_sources: bool) -> Dict[str, Any]:
    sources_cfg = config.get("sources")
    normalized: Dict[str, Dict[str, Any]] = {}

    if isinstance(sources_cfg, dict) and sources_cfg:
        for source_name, source_cfg in sources_cfg.items():
            if not isinstance(source_name, str) or not source_name.strip():
                continue
            key = source_name.strip()
            defaults = deepcopy(
                DEFAULT_SOURCES.get(
                    key,
                    {
                        "enabled": True,
                        "base_url": config.get("base_url"),
                        "article_discovery": deepcopy(config.get("article_discovery", DEFAULT_SUPPORT_ARTICLE_DISCOVERY)),
                    },
                )
            )
            if isinstance(source_cfg, dict):
                merged_source = _merge_dicts(defaults, source_cfg)
            else:
                merged_source = defaults
            if not isinstance(merged_source.get("article_discovery"), dict):
                merged_source["article_discovery"] = deepcopy(defaults.get("article_discovery", {}))
            normalized[key] = merged_source
    else:
        normalized["support"] = {
            "enabled": True,
            "base_url": config.get("base_url", "https://support.clever.com"),
            "article_discovery": deepcopy(config.get("article_discovery", DEFAULT_SUPPORT_ARTICLE_DISCOVERY)),
        }

    if not loaded_has_sources:
        legacy_base_url = config.get("base_url")
        if isinstance(legacy_base_url, str) and legacy_base_url:
            if "support" in normalized:
                normalized["support"]["base_url"] = legacy_base_url
            elif normalized:
                first_key = next(iter(normalized.keys()))
                normalized[first_key]["base_url"] = legacy_base_url

        legacy_discovery = config.get("article_discovery")
        if isinstance(legacy_discovery, dict) and legacy_discovery:
            if "support" in normalized:
                normalized["support"]["article_discovery"] = _merge_dicts(
                    deepcopy(DEFAULT_SUPPORT_ARTICLE_DISCOVERY), legacy_discovery
                )
            elif normalized:
                first_key = next(iter(normalized.keys()))
                normalized[first_key]["article_discovery"] = _merge_dicts(
                    deepcopy(DEFAULT_SUPPORT_ARTICLE_DISCOVERY), legacy_discovery
                )

    config["sources"] = normalized
    return config


def _resolve_paths(config: Dict[str, Any], config_path: str) -> Dict[str, Any]:
    base_dir = os.path.dirname(os.path.abspath(config_path))
    resolved = deepcopy(config)
    paths = resolved.get("paths", {})
    resolved_paths: Dict[str, Any] = {}
    for key, value in paths.items():
        if isinstance(value, str) and value and not os.path.isabs(value):
            resolved_paths[key] = os.path.normpath(os.path.join(base_dir, value))
        else:
            resolved_paths[key] = value
    resolved["paths"] = resolved_paths
    return resolved


def validate_config(config: Dict[str, Any]) -> Dict[str, Any]:
    base_url = config.get("base_url")
    if base_url is not None and (not isinstance(base_url, str) or not base_url.startswith(("http://", "https://"))):
        raise ValueError("Config error: base_url must be an absolute http(s) URL")

    concurrency = config.get("concurrency")
    if not isinstance(concurrency, int) or concurrency <= 0:
        raise ValueError("Config error: concurrency must be a positive integer")

    rate_limit = config.get("rate_limit_rps")
    if rate_limit is not None and (not isinstance(rate_limit, (int, float)) or rate_limit < 0):
        raise ValueError("Config error: rate_limit_rps must be a non-negative number or null")

    use_playwright = config.get("use_playwright")
    if isinstance(use_playwright, str):
        if use_playwright.lower() not in {"auto", "true", "false"}:
            raise ValueError("Config error: use_playwright must be true, false, or auto")
    elif not isinstance(use_playwright, bool):
        raise ValueError("Config error: use_playwright must be true, false, or auto")

    paths = config.get("paths")
    if not isinstance(paths, dict):
        raise ValueError("Config error: paths must be an object")
    for key in REQUIRED_PATH_KEYS:
        value = paths.get(key)
        if not isinstance(value, str) or not value.strip():
            raise ValueError(f"Config error: paths.{key} must be a non-empty string")

    sources = config.get("sources")
    if not isinstance(sources, dict) or not sources:
        raise ValueError("Config error: sources must be a non-empty object")
    enabled_sources = 0
    for source_name, source_cfg in sources.items():
        if not isinstance(source_name, str) or not source_name.strip():
            raise ValueError("Config error: source names must be non-empty strings")
        if not isinstance(source_cfg, dict):
            raise ValueError(f"Config error: sources.{source_name} must be an object")

        enabled = source_cfg.get("enabled", True)
        if not isinstance(enabled, bool):
            raise ValueError(f"Config error: sources.{source_name}.enabled must be a boolean")
        if enabled:
            enabled_sources += 1

        source_base_url = source_cfg.get("base_url")
        if not isinstance(source_base_url, str) or not source_base_url.startswith(("http://", "https://")):
            raise ValueError(f"Config error: sources.{source_name}.base_url must be an absolute http(s) URL")

        discovery_cfg = source_cfg.get("article_discovery", {})
        if not isinstance(discovery_cfg, dict):
            raise ValueError(f"Config error: sources.{source_name}.article_discovery must be an object")

        patterns = discovery_cfg.get("article_url_patterns")
        if not isinstance(patterns, list) or not patterns or not all(isinstance(p, str) and p for p in patterns):
            raise ValueError(
                f"Config error: sources.{source_name}.article_discovery.article_url_patterns must be a non-empty list of strings"
            )

        category_paths = discovery_cfg.get("category_paths")
        if category_paths is not None and (
            not isinstance(category_paths, list) or not all(isinstance(path, str) and path for path in category_paths)
        ):
            raise ValueError(
                f"Config error: sources.{source_name}.article_discovery.category_paths must be a list of non-empty strings"
            )
    if enabled_sources == 0:
        raise ValueError("Config error: at least one source must be enabled")

    fetch_cfg = config.get("fetch", {})
    timeout = fetch_cfg.get("timeout_seconds")
    retries = fetch_cfg.get("retries")
    if not isinstance(timeout, (int, float)) or timeout <= 0:
        raise ValueError("Config error: fetch.timeout_seconds must be > 0")
    if not isinstance(retries, int) or retries < 1:
        raise ValueError("Config error: fetch.retries must be >= 1")

    extraction = config.get("extraction", {})
    min_body_chars = extraction.get("min_body_chars")
    selectors = extraction.get("selectors")
    if not isinstance(min_body_chars, int) or min_body_chars < 0:
        raise ValueError("Config error: extraction.min_body_chars must be >= 0")
    if not isinstance(selectors, list) or not selectors:
        raise ValueError("Config error: extraction.selectors must be a non-empty list")

    chunking = config.get("chunking", {})
    min_tokens = chunking.get("min_tokens")
    target_tokens = chunking.get("target_tokens")
    max_tokens = chunking.get("max_tokens")
    if not isinstance(min_tokens, int) or min_tokens <= 0:
        raise ValueError("Config error: chunking.min_tokens must be > 0")
    if not isinstance(target_tokens, int) or target_tokens <= 0:
        raise ValueError("Config error: chunking.target_tokens must be > 0")
    if not isinstance(max_tokens, int) or max_tokens <= 0:
        raise ValueError("Config error: chunking.max_tokens must be > 0")
    if min_tokens > max_tokens:
        raise ValueError("Config error: chunking.min_tokens must be <= chunking.max_tokens")
    if not (min_tokens <= target_tokens <= max_tokens):
        raise ValueError("Config error: chunking.target_tokens must be between min_tokens and max_tokens")

    return config


def load_config(path: Optional[str] = None) -> Dict[str, Any]:
    config = deepcopy(DEFAULT_CONFIG)
    config_path: Optional[str] = None
    loaded_has_sources = False
    if path is None:
        if os.path.exists("config.yaml"):
            path = "config.yaml"
        elif os.path.exists("config.yml"):
            path = "config.yml"
    if path and not os.path.exists(path):
        raise FileNotFoundError(f"Config file not found: {path}")
    if path and os.path.exists(path):
        config_path = path
        with open(path, "r", encoding="utf-8") as f:
            loaded = yaml.safe_load(f) or {}
        if not isinstance(loaded, dict):
            raise ValueError("Config error: root YAML node must be an object")
        loaded_has_sources = "sources" in loaded
        config = _merge_dicts(config, loaded)
    if config_path:
        config = _resolve_paths(config, config_path)
    config = _normalize_sources(config, loaded_has_sources=loaded_has_sources)
    return validate_config(config)


def get_path(config: Dict[str, Any], key: str) -> str:
    return config["paths"][key]


def get_sources(config: Dict[str, Any], enabled_only: bool = False) -> List[Tuple[str, Dict[str, Any]]]:
    sources = config.get("sources")
    if not isinstance(sources, dict):
        return []
    selected: List[Tuple[str, Dict[str, Any]]] = []
    for source_name, source_cfg in sources.items():
        if not isinstance(source_cfg, dict):
            continue
        if enabled_only and not source_cfg.get("enabled", True):
            continue
        selected.append((source_name, source_cfg))
    return selected


def get_source_hosts(config: Dict[str, Any], enabled_only: bool = False) -> Set[str]:
    hosts: Set[str] = set()
    for _, source_cfg in get_sources(config, enabled_only=enabled_only):
        base_url = source_cfg.get("base_url")
        if not isinstance(base_url, str):
            continue
        host = urlparse(base_url).netloc.lower()
        if host:
            hosts.add(host)
    return hosts


def source_for_url(config: Dict[str, Any], url: str) -> Optional[str]:
    target_host = urlparse(url).netloc.lower()
    if not target_host:
        return None
    for source_name, source_cfg in get_sources(config, enabled_only=False):
        base_url = source_cfg.get("base_url")
        if not isinstance(base_url, str):
            continue
        host = urlparse(base_url).netloc.lower()
        if host == target_host:
            return source_name
    return None
