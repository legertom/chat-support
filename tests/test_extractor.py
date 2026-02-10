from support_scraper.extractor import extract_article


def test_extract_article_basic_fields():
    html = """
    <html>
      <head>
        <title>Fallback title</title>
        <meta property="og:title" content="How to Reset Password" />
        <meta property="article:published_time" content="2025-01-01T10:00:00Z" />
      </head>
      <body>
        <article>
          <h1>How to Reset Password</h1>
          <p>Use the account settings page to reset your password safely and quickly.</p>
          <p>This paragraph is intentionally long enough to satisfy the minimum body length check.</p>
          <a href="/download/user-guide.pdf">Download User Guide</a>
          <h2>Related Articles</h2>
          <ul>
            <li><a href="/s/article/related-one">Related One</a></li>
          </ul>
        </article>
      </body>
    </html>
    """
    config = {
        "extraction": {
            "min_body_chars": 40,
            "selectors": ["article"],
            "remove_selectors": [],
        }
    }

    article = extract_article(html, "https://support.clever.com/s/article/reset-password", config)

    assert article["title"] == "How to Reset Password"
    assert article["url"] == "https://support.clever.com/s/article/reset-password"
    assert article["published_at"] is not None
    assert "reset your password safely" in article["body_text"].lower()
    assert article["attachments"][0]["url"] == "https://support.clever.com/download/user-guide.pdf"
    assert article["related_links"][0]["url"] == "https://support.clever.com/s/article/related-one"
    assert article["source"] == "support"
    assert article["source_host"] == "support.clever.com"
    assert article["doc_id"].startswith("support-clever:")
