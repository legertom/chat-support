from support_scraper.chunker import chunk_article


def test_chunker_respects_max_tokens_and_chunk_ids():
    long_paragraph = " ".join(["This is a sentence for chunking."] * 220)
    article = {
        "doc_id": "support-clever:test-doc",
        "url": "https://support.clever.com/s/article/test",
        "title": "Test Article",
        "updated_at": None,
        "breadcrumbs": [],
        "tags": [],
        "source": "support",
        "source_host": "support.clever.com",
        "scraped_at": "2026-01-01T00:00:00+00:00",
        "content_hash": "abc123",
        "body_markdown": f"## Steps\n\n{long_paragraph}",
    }
    cfg = {"target_tokens": 40, "min_tokens": 1, "max_tokens": 50}

    chunks = chunk_article(article, cfg)

    assert chunks
    assert all(chunk["tokens_estimate"] <= 50 for chunk in chunks)
    assert all(chunk["text"] for chunk in chunks)
    assert all(chunk["source"] == "support" for chunk in chunks)
    assert all(chunk["source_host"] == "support.clever.com" for chunk in chunks)
    assert [chunk["chunk_id"] for chunk in chunks] == [
        f"support-clever:test-doc#{idx}" for idx in range(len(chunks))
    ]
