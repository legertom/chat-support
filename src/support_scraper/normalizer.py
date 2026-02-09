import re
from typing import List, Optional
from urllib.parse import urljoin

from bs4 import BeautifulSoup, Tag
from markdownify import MarkdownConverter

from .utils import normalize_whitespace


class ArticleMarkdownConverter(MarkdownConverter):
    def convert_h1(self, el, text, convert_as_inline=False, **kwargs):
        return f"## {text}\n\n"

    def convert_h2(self, el, text, convert_as_inline=False, **kwargs):
        return f"## {text}\n\n"

    def convert_h3(self, el, text, convert_as_inline=False, **kwargs):
        return f"### {text}\n\n"

    def convert_h4(self, el, text, convert_as_inline=False, **kwargs):
        return f"#### {text}\n\n"

    def convert_pre(self, el, text, convert_as_inline=False, **kwargs):
        code = el.get_text("\n")
        return f"\n```\n{code}\n```\n\n"


def _is_callout(tag: Tag) -> Optional[str]:
    classes = " ".join(tag.get("class", []))
    text = tag.get_text(" ").lower()
    if any(word in classes for word in ["note", "tip", "warning", "important", "alert"]):
        return _infer_callout_label(text)
    if any(word in text for word in ["note:", "tip:", "warning:", "important:"]):
        return _infer_callout_label(text)
    return None


def _infer_callout_label(text: str) -> str:
    if "warning" in text:
        return "Warning"
    if "important" in text:
        return "Important"
    if "tip" in text:
        return "Tip"
    return "Note"


def _convert_callouts(soup: BeautifulSoup) -> None:
    for tag in list(soup.find_all(True)):
        label = _is_callout(tag)
        if not label:
            continue
        content = tag.get_text(" ").strip()
        if not content:
            continue
        blockquote = soup.new_tag("blockquote")
        p = soup.new_tag("p")
        p.string = f"{label}: {content}"
        blockquote.append(p)
        tag.replace_with(blockquote)


def _convert_tables(soup: BeautifulSoup) -> None:
    for table in soup.find_all("table"):
        rows = []
        for tr in table.find_all("tr"):
            cells = [cell.get_text(" ").strip() for cell in tr.find_all(["th", "td"])]
            if cells:
                rows.append(cells)
        if not rows:
            table.decompose()
            continue
        # Flatten table to key/value if possible
        lines: List[str] = []
        if all(len(row) == 2 for row in rows):
            for key, value in rows:
                lines.append(f"- {key}: {value}")
        else:
            header = rows[0]
            for row in rows[1:]:
                pairs = []
                for idx, value in enumerate(row):
                    key = header[idx] if idx < len(header) else f"Field {idx+1}"
                    pairs.append(f"{key}: {value}")
                lines.append("- " + "; ".join(pairs))
        replacement = soup.new_tag("p")
        replacement.string = "\n".join(lines)
        table.replace_with(replacement)


def _absolute_links(soup: BeautifulSoup, base_url: str) -> None:
    for a in soup.find_all("a", href=True):
        href = a.get("href")
        if not href:
            continue
        if href.startswith("mailto:"):
            continue
        a["href"] = urljoin(base_url, href)


def html_to_markdown(html: str, base_url: str) -> str:
    soup = BeautifulSoup(html, "lxml")
    _absolute_links(soup, base_url)
    _convert_tables(soup)
    _convert_callouts(soup)
    converter = ArticleMarkdownConverter(bullets="-")
    md = converter.convert_soup(soup)
    md = re.sub(r"\n{3,}", "\n\n", md)
    md = normalize_whitespace(md)
    # Remove empty headings
    md = re.sub(r"^#+\s*$", "", md, flags=re.MULTILINE)
    md = normalize_whitespace(md)
    return md
