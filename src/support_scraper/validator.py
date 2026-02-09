import random
from typing import Any, Dict, List, Tuple

from .utils import estimate_tokens


def validate_articles(articles: List[Dict[str, Any]]) -> Tuple[List[str], List[str]]:
    errors: List[str] = []
    warnings: List[str] = []
    for idx, article in enumerate(articles):
        for field in ["doc_id", "url", "title", "body_markdown"]:
            if not article.get(field):
                errors.append(f"Missing {field} for index {idx}")
        if len(article.get("body_markdown", "")) < 10:
            warnings.append(f"Short body for {article.get('url')}")
    return errors, warnings


def sample_articles(articles: List[Dict[str, Any]], k: int = 10) -> List[Dict[str, Any]]:
    if not articles:
        return []
    if len(articles) <= k:
        return articles
    return random.sample(articles, k)


def chunk_counts(chunks: List[Dict[str, Any]]) -> Dict[str, int]:
    counts: Dict[str, int] = {}
    for chunk in chunks:
        doc_id = chunk.get("doc_id")
        counts[doc_id] = counts.get(doc_id, 0) + 1
    return counts


def token_stats(chunks: List[Dict[str, Any]]) -> Dict[str, float]:
    if not chunks:
        return {"avg": 0, "max": 0}
    tokens = [c.get("tokens_estimate", estimate_tokens(c.get("text", ""))) for c in chunks]
    return {"avg": sum(tokens) / len(tokens), "max": max(tokens)}
