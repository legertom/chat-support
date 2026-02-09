import re
from typing import Any, Dict, List, Tuple

from .utils import estimate_tokens, normalize_whitespace


def _parse_sections(markdown: str, title: str) -> List[Dict[str, Any]]:
    sections: List[Dict[str, Any]] = []
    lines = markdown.splitlines()
    stack: List[str] = []
    buffer: List[str] = []

    def flush():
        if not buffer:
            return
        content = "\n".join(buffer).strip()
        if not content:
            buffer.clear()
            return
        heading_path = [title] + stack if stack else [title]
        section_label = stack[-1] if stack else title
        sections.append({"heading_path": heading_path, "section": section_label, "content": content})
        buffer.clear()

    for line in lines:
        heading_match = re.match(r"^(#{2,4})\s+(.*)$", line)
        if heading_match:
            flush()
            level = len(heading_match.group(1)) - 1
            text = heading_match.group(2).strip()
            while len(stack) >= level:
                stack.pop()
            if text:
                stack.append(text)
            continue
        buffer.append(line)
    flush()
    if not sections:
        sections.append({"heading_path": [title], "section": title, "content": markdown.strip()})
    return sections


def _split_blocks(text: str) -> List[str]:
    blocks: List[str] = []
    current: List[str] = []
    in_code = False
    for line in text.splitlines():
        if line.strip().startswith("```"):
            in_code = not in_code
            current.append(line)
            if not in_code:
                blocks.append("\n".join(current).strip())
                current = []
            continue
        if in_code:
            current.append(line)
            continue
        if line.strip() == "":
            if current:
                blocks.append("\n".join(current).strip())
                current = []
            continue
        current.append(line)
    if current:
        blocks.append("\n".join(current).strip())
    return [b for b in blocks if b]


def _is_list_block(block: str) -> bool:
    return any(line.strip().startswith("-") or re.match(r"^\d+\.\s+", line.strip()) for line in block.splitlines())


def _split_long_text(block: str, max_tokens: int) -> List[str]:
    sentences = re.split(r"(?<=[.!?])\s+", block)
    chunks: List[str] = []
    current: List[str] = []
    for sentence in sentences:
        if not sentence:
            continue
        tentative = " ".join(current + [sentence]).strip()
        if estimate_tokens(tentative) > max_tokens and current:
            chunks.append(" ".join(current).strip())
            current = [sentence]
        else:
            current.append(sentence)
    if current:
        chunks.append(" ".join(current).strip())
    return chunks


def _split_list_block(block: str, max_tokens: int) -> List[str]:
    items = []
    current_item: List[str] = []
    for line in block.splitlines():
        if line.strip().startswith("-") or re.match(r"^\d+\.\s+", line.strip()):
            if current_item:
                items.append("\n".join(current_item))
                current_item = []
        current_item.append(line)
    if current_item:
        items.append("\n".join(current_item))

    chunks: List[str] = []
    current: List[str] = []
    for item in items:
        tentative = "\n".join(current + [item]).strip()
        if estimate_tokens(tentative) > max_tokens and current:
            chunks.append("\n".join(current).strip())
            current = [item]
        else:
            current.append(item)
    if current:
        chunks.append("\n".join(current).strip())
    return chunks


def chunk_article(article: Dict[str, Any], chunk_cfg: Dict[str, Any]) -> List[Dict[str, Any]]:
    markdown = article.get("body_markdown", "")
    title = article.get("title", "")
    sections = _parse_sections(markdown, title)
    chunks: List[Dict[str, Any]] = []
    max_tokens = chunk_cfg.get("max_tokens", 500)
    min_tokens = chunk_cfg.get("min_tokens", 200)

    chunk_index = 0
    for section in sections:
        blocks = _split_blocks(section["content"])
        current_lines: List[str] = []
        for block in blocks:
            block_tokens = estimate_tokens(block)
            if block_tokens > max_tokens:
                # Split oversized block
                if _is_list_block(block):
                    sub_blocks = _split_list_block(block, max_tokens)
                else:
                    sub_blocks = _split_long_text(block, max_tokens)
                for sub in sub_blocks:
                    if current_lines:
                        chunk_text = "\n\n".join(current_lines).strip()
                        if chunk_text:
                            chunks.append(_build_chunk(article, section, chunk_text, chunk_index))
                            chunk_index += 1
                        current_lines = []
                    chunks.append(_build_chunk(article, section, sub, chunk_index))
                    chunk_index += 1
                continue
            tentative = "\n\n".join(current_lines + [block]).strip()
            if estimate_tokens(tentative) > max_tokens and current_lines:
                chunk_text = "\n\n".join(current_lines).strip()
                if chunk_text:
                    chunks.append(_build_chunk(article, section, chunk_text, chunk_index))
                    chunk_index += 1
                current_lines = [block]
            else:
                current_lines.append(block)
        if current_lines:
            chunk_text = "\n\n".join(current_lines).strip()
            if chunk_text:
                chunks.append(_build_chunk(article, section, chunk_text, chunk_index))
                chunk_index += 1

    # Merge tiny chunks with neighbors
    merged: List[Dict[str, Any]] = []
    buffer = None
    for chunk in chunks:
        if not buffer:
            buffer = chunk
            continue
        if chunk["tokens_estimate"] < min_tokens:
            buffer["text"] = normalize_whitespace(buffer["text"] + "\n\n" + chunk["text"])
            buffer["tokens_estimate"] = estimate_tokens(buffer["text"])
        else:
            merged.append(buffer)
            buffer = chunk
    if buffer:
        merged.append(buffer)
    # Re-index chunk ids
    for idx, chunk in enumerate(merged):
        chunk["chunk_id"] = f"{article['doc_id']}#{idx}"
    return merged


def _build_chunk(article: Dict[str, Any], section: Dict[str, Any], text: str, index: int) -> Dict[str, Any]:
    text = normalize_whitespace(text)
    return {
        "chunk_id": f"{article['doc_id']}#{index}",
        "doc_id": article["doc_id"],
        "url": article["url"],
        "title": article["title"],
        "heading_path": section["heading_path"],
        "section": section["section"],
        "text": text,
        "tokens_estimate": estimate_tokens(text),
        "updated_at": article.get("updated_at"),
        "breadcrumbs": article.get("breadcrumbs", []),
        "tags": article.get("tags", []),
        "scraped_at": article.get("scraped_at"),
        "content_hash": article.get("content_hash"),
    }
