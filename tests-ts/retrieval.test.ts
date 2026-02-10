import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_CHUNKS_PATH = process.env.CHUNKS_PATH;

async function writeChunksFile(records: Array<Record<string, unknown>>) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "chunks-"));
  const chunksPath = path.join(tempDir, "chunks.jsonl");
  const content = records.map((record) => JSON.stringify(record)).join("\n");
  await fs.writeFile(chunksPath, `${content}\n`, "utf8");
  return { tempDir, chunksPath };
}

describe("retrieveTopChunks source selection", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(async () => {
    if (ORIGINAL_CHUNKS_PATH === undefined) {
      delete process.env.CHUNKS_PATH;
    } else {
      process.env.CHUNKS_PATH = ORIGINAL_CHUNKS_PATH;
    }
  });

  it("returns only requested sources when filtering", async () => {
    const fixture = await writeChunksFile([
      {
        chunk_id: "support-clever:s1#0",
        doc_id: "support-clever:s1",
        url: "https://support.clever.com/s/article/login-help",
        title: "Portal login help",
        section: "Overview",
        text: "Users can login through the Clever Portal dashboard.",
        source: "support",
      },
      {
        chunk_id: "dev-clever:d1#0",
        doc_id: "dev-clever:d1",
        url: "https://dev.clever.com/docs/login",
        title: "Developer login guide",
        section: "Overview",
        text: "Developers login with OAuth tokens for API access.",
        source: "dev",
      },
    ]);
    process.env.CHUNKS_PATH = fixture.chunksPath;

    try {
      const retrieval = await import("@/lib/retrieval");
      const supportOnly = await retrieval.retrieveTopChunks("login", 6, undefined, { sources: ["support"] });
      const devOnly = await retrieval.retrieveTopChunks("login", 6, undefined, { sources: ["dev"] });
      const both = await retrieval.retrieveTopChunks("login", 6, undefined, { sources: ["support", "dev"] });

      expect(supportOnly.length).toBeGreaterThan(0);
      expect(devOnly.length).toBeGreaterThan(0);
      expect(supportOnly.every((item) => item.chunk.source === "support")).toBe(true);
      expect(devOnly.every((item) => item.chunk.source === "dev")).toBe(true);
      expect(new Set(both.map((item) => item.chunk.source))).toEqual(new Set(["support", "dev"]));
    } finally {
      await fs.rm(fixture.tempDir, { recursive: true, force: true });
    }
  });

  it("infers source from URL when source is missing in chunk rows", async () => {
    const fixture = await writeChunksFile([
      {
        chunk_id: "dev-clever:d2#0",
        doc_id: "dev-clever:d2",
        url: "https://dev.clever.com/docs/authentication",
        title: "Auth docs",
        section: "Overview",
        text: "Use OAuth client credentials for authentication.",
      },
      {
        chunk_id: "support-clever:s2#0",
        doc_id: "support-clever:s2",
        url: "https://support.clever.com/s/article/auth-help",
        title: "Auth support",
        section: "Overview",
        text: "District admins can reset sign-in settings.",
      },
    ]);
    process.env.CHUNKS_PATH = fixture.chunksPath;

    try {
      const retrieval = await import("@/lib/retrieval");
      const devResults = await retrieval.retrieveTopChunks("authentication oauth", 6, undefined, { sources: ["dev"] });
      const stats = await retrieval.getChunkStats();

      expect(devResults.length).toBeGreaterThan(0);
      expect(devResults.every((item) => item.chunk.source === "dev")).toBe(true);
      expect(stats.sourceDocCounts.dev).toBe(1);
      expect(stats.sourceDocCounts.support).toBe(1);
      expect(stats.sourceChunkCounts.dev).toBe(1);
      expect(stats.sourceChunkCounts.support).toBe(1);
    } finally {
      await fs.rm(fixture.tempDir, { recursive: true, force: true });
    }
  });
});
