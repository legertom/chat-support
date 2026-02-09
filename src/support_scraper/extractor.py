import re
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urljoin

from bs4 import BeautifulSoup, Tag
from dateutil import parser as date_parser

from .normalizer import html_to_markdown
from .utils import normalize_url, normalize_whitespace, sha256_text, strip_markdown

SALESFORCE_ID_RE = re.compile(r"\bka[0-9A-Za-z]{13,18}\b")


def extract_salesforce_id(html: str) -> Optional[str]:
    match = SALESFORCE_ID_RE.search(html)
    if match:
        return match.group(0)
    return None


def _text_or_none(tag: Optional[Tag]) -> Optional[str]:
    if not tag:
        return None
    text = tag.get_text(" ").strip()
    return text or None


def _find_title(soup: BeautifulSoup) -> Optional[str]:
    h1 = soup.find("h1")
    if h1:
        return h1.get_text(" ").strip()
    og = soup.find("meta", attrs={"property": "og:title"})
    if og and og.get("content"):
        return og["content"].strip()
    title_tag = soup.find("title")
    if title_tag:
        return title_tag.get_text(" ").strip()
    return None


def _parse_date(text: str) -> Optional[str]:
    if not text:
        return None
    try:
        dt = date_parser.parse(text, fuzzy=True)
        return dt.isoformat()
    except Exception:
        return None


def _extract_dates(soup: BeautifulSoup) -> Tuple[Optional[str], Optional[str]]:
    updated = None
    published = None
    for meta in soup.find_all("meta"):
        if meta.get("property") in {"article:modified_time", "og:updated_time"}:
            updated = _parse_date(meta.get("content", "")) or updated
        if meta.get("property") in {"article:published_time", "og:published_time"}:
            published = _parse_date(meta.get("content", "")) or published
    if updated or published:
        return updated, published
    # Look for time elements
    for time_tag in soup.find_all("time"):
        label = time_tag.get("datetime") or time_tag.get_text(" ")
        parsed = _parse_date(label)
        if parsed and not updated:
            updated = parsed
    # Look for labels
    text = soup.get_text(" ")
    updated_match = re.search(r"Updated\s*[:\-]?\s*([A-Za-z0-9, ]{4,})", text)
    if updated_match:
        updated = _parse_date(updated_match.group(1)) or updated
    published_match = re.search(r"Published\s*[:\-]?\s*([A-Za-z0-9, ]{4,})", text)
    if published_match:
        published = _parse_date(published_match.group(1)) or published
    return updated, published


def _extract_breadcrumbs(soup: BeautifulSoup) -> List[str]:
    crumbs: List[str] = []
    nav = soup.find("nav", attrs={"aria-label": re.compile("breadcrumb", re.I)})
    if nav:
        for li in nav.find_all(["li", "a", "span"]):
            text = li.get_text(" ").strip()
            if text and text.lower() not in {"home"}:
                crumbs.append(text)
    if not crumbs:
        container = soup.select_one(".slds-breadcrumb, .breadcrumbs")
        if container:
            for item in container.find_all(["li", "a", "span"]):
                text = item.get_text(" ").strip()
                if text and text.lower() not in {"home"}:
                    crumbs.append(text)
    return crumbs


def _extract_tags(soup: BeautifulSoup) -> List[str]:
    tags: List[str] = []
    for meta in soup.find_all("meta", attrs={"property": "article:tag"}):
        if meta.get("content"):
            tags.append(meta["content"].strip())
    if not tags:
        keywords = soup.find("meta", attrs={"name": "keywords"})
        if keywords and keywords.get("content"):
            tags.extend([kw.strip() for kw in keywords["content"].split(",") if kw.strip()])
    if not tags:
        tag_container = soup.select_one(".tags, .article-tags, .topic-tags")
        if tag_container:
            for tag in tag_container.find_all("a"):
                text = tag.get_text(" ").strip()
                if text:
                    tags.append(text)
    return list(dict.fromkeys(tags))


def _extract_summary(soup: BeautifulSoup) -> Optional[str]:
    desc = soup.find("meta", attrs={"name": "description"})
    if desc and desc.get("content"):
        return desc["content"].strip()
    return None


def _remove_unwanted(body: Tag, remove_selectors: List[str]) -> None:
    for selector in remove_selectors:
        for tag in body.select(selector):
            tag.decompose()
    for tag in body.find_all(True):
        if tag.get("aria-hidden") == "true":
            tag.decompose()
        style = tag.get("style", "")
        if "display:none" in style.replace(" ", "").lower():
            tag.decompose()


def _score_node(node: Tag, title: Optional[str]) -> float:
    text = node.get_text(" ").strip()
    if len(text) < 200:
        return 0.0
    link_text = "".join(a.get_text(" ") for a in node.find_all("a"))
    link_density = len(link_text) / max(1, len(text))
    headings = len(node.find_all(["h2", "h3", "h4"]))
    lists = len(node.find_all(["ul", "ol"]))
    score = len(text) / 100
    score += headings * 5
    score += lists * 3
    score -= link_density * 50
    if title and title.lower() in text.lower():
        score += 10
    class_text = " ".join(node.get("class", []))
    if any(word in class_text.lower() for word in ["nav", "footer", "header", "breadcrumb", "menu"]):
        score -= 20
    return score


def _select_body(soup: BeautifulSoup, selectors: List[str], title: Optional[str]) -> Optional[Tag]:
    candidates: List[Tag] = []
    for selector in selectors:
        candidates.extend(soup.select(selector))
    if not candidates:
        candidates = soup.find_all(["article", "main", "section", "div"])
    best = None
    best_score = 0.0
    for node in candidates:
        score = _score_node(node, title)
        if score > best_score:
            best_score = score
            best = node
    return best


def _extract_attachments(body: Tag, base_url: str) -> List[Dict[str, str]]:
    attachments: List[Dict[str, str]] = []
    for link in body.find_all("a", href=True):
        href = link.get("href")
        text = link.get_text(" ").strip()
        if not href:
            continue
        if any(token in href for token in ["FileDownload", "servlet.shepherd", "download"]):
            attachments.append({"name": text or href.split("/")[-1], "url": urljoin(base_url, href)})
    return attachments


def _extract_related_links(body: Tag, base_url: str) -> List[Dict[str, str]]:
    related: List[Dict[str, str]] = []
    for heading in body.find_all(["h2", "h3", "h4"]):
        heading_text = heading.get_text(" ").strip().lower()
        if "related" in heading_text:
            section = heading.find_next_sibling()
            while section and section.name not in ["h2", "h3", "h4"]:
                for link in section.find_all("a", href=True):
                    href = link.get("href")
                    label = link.get_text(" ").strip()
                    if href:
                        related.append({"label": label or href, "url": urljoin(base_url, href)})
                next_section = section.find_next_sibling()
                section.decompose()
                section = next_section
            heading.decompose()
    return related


def extract_article(html: str, url: str, config: Dict[str, Any]) -> Dict[str, Any]:
    soup = BeautifulSoup(html, "lxml")
    canonical_tag = soup.find("link", rel="canonical")
    canonical_url = normalize_url(canonical_tag["href"], url) if canonical_tag and canonical_tag.get("href") else normalize_url(url)
    title = _find_title(soup) or ""
    updated_at, published_at = _extract_dates(soup)
    breadcrumbs = _extract_breadcrumbs(soup)
    tags = _extract_tags(soup)
    summary = _extract_summary(soup)

    body = _select_body(soup, config["extraction"]["selectors"], title)
    if not body:
        raise ValueError("No article body found")
    _remove_unwanted(body, config["extraction"]["remove_selectors"])
    related_links = _extract_related_links(body, url)
    attachments = _extract_attachments(body, url)

    markdown = html_to_markdown(str(body), canonical_url)
    markdown = normalize_whitespace(markdown)
    body_text = strip_markdown(markdown)

    if len(body_text) < config["extraction"]["min_body_chars"]:
        raise ValueError("Extracted body too short")
    if not title or len(title) < 3:
        raise ValueError("Missing or empty title")

    salesforce_id = extract_salesforce_id(html)
    stable_id = salesforce_id or sha256_text(canonical_url)
    doc_id = f"support-clever:{stable_id}"
    content_hash = sha256_text(f"{title}|{updated_at or ''}|{markdown}")

    return {
        "doc_id": doc_id,
        "url": canonical_url,
        "title": title,
        "updated_at": updated_at,
        "published_at": published_at,
        "breadcrumbs": breadcrumbs,
        "tags": tags,
        "summary": summary,
        "body_markdown": markdown,
        "body_text": body_text,
        "attachments": attachments,
        "related_links": related_links,
        "source": "support.clever.com",
        "content_hash": content_hash,
    }
