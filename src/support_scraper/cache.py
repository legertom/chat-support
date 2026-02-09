import aiosqlite
from typing import Any, Dict, Optional


class Cache:
    def __init__(self, path: str) -> None:
        self.path = path
        self.conn: Optional[aiosqlite.Connection] = None

    async def open(self) -> None:
        self.conn = await aiosqlite.connect(self.path)
        await self.conn.execute(
            """
            CREATE TABLE IF NOT EXISTS cache (
                url TEXT PRIMARY KEY,
                doc_id TEXT,
                content_hash TEXT,
                updated_at TEXT,
                etag TEXT,
                last_modified TEXT,
                last_scraped TEXT,
                status TEXT,
                error TEXT
            )
            """
        )
        await self.conn.commit()

    async def close(self) -> None:
        if self.conn:
            await self.conn.close()
            self.conn = None

    async def get(self, url: str) -> Optional[Dict[str, Any]]:
        if not self.conn:
            raise RuntimeError("Cache not opened")
        async with self.conn.execute("SELECT url, doc_id, content_hash, updated_at, etag, last_modified, last_scraped, status, error FROM cache WHERE url = ?", (url,)) as cursor:
            row = await cursor.fetchone()
        if not row:
            return None
        return {
            "url": row[0],
            "doc_id": row[1],
            "content_hash": row[2],
            "updated_at": row[3],
            "etag": row[4],
            "last_modified": row[5],
            "last_scraped": row[6],
            "status": row[7],
            "error": row[8],
        }

    async def upsert(self, url: str, **fields: Any) -> None:
        if not self.conn:
            raise RuntimeError("Cache not opened")
        data = {
            "url": url,
            "doc_id": fields.get("doc_id"),
            "content_hash": fields.get("content_hash"),
            "updated_at": fields.get("updated_at"),
            "etag": fields.get("etag"),
            "last_modified": fields.get("last_modified"),
            "last_scraped": fields.get("last_scraped"),
            "status": fields.get("status"),
            "error": fields.get("error"),
        }
        await self.conn.execute(
            """
            INSERT INTO cache (url, doc_id, content_hash, updated_at, etag, last_modified, last_scraped, status, error)
            VALUES (:url, :doc_id, :content_hash, :updated_at, :etag, :last_modified, :last_scraped, :status, :error)
            ON CONFLICT(url) DO UPDATE SET
                doc_id=COALESCE(excluded.doc_id, cache.doc_id),
                content_hash=COALESCE(excluded.content_hash, cache.content_hash),
                updated_at=COALESCE(excluded.updated_at, cache.updated_at),
                etag=COALESCE(excluded.etag, cache.etag),
                last_modified=COALESCE(excluded.last_modified, cache.last_modified),
                last_scraped=COALESCE(excluded.last_scraped, cache.last_scraped),
                status=COALESCE(excluded.status, cache.status),
                error=COALESCE(excluded.error, cache.error)
            """,
            data,
        )
        await self.conn.commit()
