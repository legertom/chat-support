import fs from "node:fs/promises";
import { getChunksPath, type ChunkRecord } from "@/lib/retrieval";

export type DocsSourceFilter = "all" | "support" | "dev";

export interface DocSummary {
  docId: string;
  title: string;
  url: string;
  source: string;
  sourceHost: string;
  updatedAt: string | null;
  chunkCount: number;
  sectionCount: number;
}

export interface DocChunkView {
  chunkId: string;
  section: string | null;
  headingPath: string[];
  text: string;
  tokensEstimate: number | null;
}

export interface DocDetail extends DocSummary {
  chunks: DocChunkView[];
}

interface DocIndexEntry {
  summary: DocSummary;
  sections: Set<string>;
  chunks: DocChunkView[];
}

interface DocsIndex {
  docs: DocIndexEntry[];
  totalChunkCount: number;
  sourceDocCounts: Record<string, number>;
  sourceChunkCounts: Record<string, number>;
  chunksPath: string;
}

export interface DocsBrowserResult {
  docs: DocSummary[];
  selectedDoc: DocDetail | null;
  selectedDocMissing: boolean;
  totalDocCount: number;
  totalChunkCount: number;
  sourceDocCounts: Record<string, number>;
  sourceChunkCounts: Record<string, number>;
  chunksPath: string;
  filteredCount: number;
  query: string;
  source: DocsSourceFilter;
}

let docsIndexPromise: Promise<DocsIndex> | null = null;
type DocsChunkRecord = ChunkRecord & { updated_at?: string | null };

export async function getDocsBrowserResult(input: {
  source: DocsSourceFilter;
  query: string;
  selectedDocId?: string;
}): Promise<DocsBrowserResult> {
  const docsIndex = await getDocsIndex();
  const normalizedQuery = input.query.trim().toLowerCase();

  const filteredEntries = docsIndex.docs.filter((entry) => {
    if (input.source !== "all" && entry.summary.source !== input.source) {
      return false;
    }

    if (!normalizedQuery) {
      return true;
    }

    if (entry.summary.title.toLowerCase().includes(normalizedQuery)) {
      return true;
    }

    if (entry.summary.url.toLowerCase().includes(normalizedQuery)) {
      return true;
    }

    return entry.chunks.some((chunk) => chunk.section?.toLowerCase().includes(normalizedQuery));
  });

  const selectedDocId = input.selectedDocId?.trim();
  const selectedEntry = selectedDocId
    ? filteredEntries.find((entry) => entry.summary.docId === selectedDocId) ?? null
    : filteredEntries[0] ?? null;

  const selectedDoc: DocDetail | null = selectedEntry
    ? {
        ...selectedEntry.summary,
        chunks: selectedEntry.chunks,
      }
    : null;

  return {
    docs: filteredEntries.map((entry) => entry.summary),
    selectedDoc,
    selectedDocMissing: Boolean(selectedDocId) && selectedEntry === null,
    totalDocCount: docsIndex.docs.length,
    totalChunkCount: docsIndex.totalChunkCount,
    sourceDocCounts: docsIndex.sourceDocCounts,
    sourceChunkCounts: docsIndex.sourceChunkCounts,
    chunksPath: docsIndex.chunksPath,
    filteredCount: filteredEntries.length,
    query: input.query,
    source: input.source,
  };
}

async function getDocsIndex(): Promise<DocsIndex> {
  if (!docsIndexPromise) {
    docsIndexPromise = buildDocsIndex().catch((error) => {
      docsIndexPromise = null;
      throw error;
    });
  }

  return docsIndexPromise;
}

async function buildDocsIndex(): Promise<DocsIndex> {
  const chunksPath = getChunksPath();
  const raw = await fs.readFile(chunksPath, "utf8");
  const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);

  const byDocId = new Map<string, DocIndexEntry>();
  const sourceDocCounts: Record<string, number> = {};
  const sourceChunkCounts: Record<string, number> = {};

  for (const line of lines) {
    let parsed: DocsChunkRecord;
    try {
      parsed = JSON.parse(line) as ChunkRecord;
    } catch {
      continue;
    }

    if (!parsed.doc_id || !parsed.chunk_id || !parsed.url || !parsed.title || !parsed.text) {
      continue;
    }

    const source = normalizeSource(parsed.source, parsed.url);
    const sourceHost = resolveSourceHost(parsed.source_host, parsed.url);
    const existing = byDocId.get(parsed.doc_id);

    if (!existing) {
      byDocId.set(parsed.doc_id, {
        summary: {
          docId: parsed.doc_id,
          title: parsed.title,
          url: parsed.url,
          source,
          sourceHost,
          updatedAt: parsed.updated_at ?? null,
          chunkCount: 0,
          sectionCount: 0,
        },
        sections: new Set<string>(),
        chunks: [],
      });
      sourceDocCounts[source] = (sourceDocCounts[source] ?? 0) + 1;
    }

    const entry = byDocId.get(parsed.doc_id);
    if (!entry) {
      continue;
    }

    entry.summary.chunkCount += 1;
    sourceChunkCounts[source] = (sourceChunkCounts[source] ?? 0) + 1;

    if (parsed.updated_at && (!entry.summary.updatedAt || parsed.updated_at > entry.summary.updatedAt)) {
      entry.summary.updatedAt = parsed.updated_at;
    }

    if (parsed.section) {
      entry.sections.add(parsed.section);
    }

    entry.chunks.push({
      chunkId: parsed.chunk_id,
      section: parsed.section ?? null,
      headingPath: Array.isArray(parsed.heading_path) ? parsed.heading_path : [],
      text: parsed.text,
      tokensEstimate: typeof parsed.tokens_estimate === "number" ? parsed.tokens_estimate : null,
    });
  }

  const docs = [...byDocId.values()]
    .map((entry) => {
      entry.summary.sectionCount = entry.sections.size;
      entry.chunks.sort((left, right) => compareChunkIds(left.chunkId, right.chunkId));
      return entry;
    })
    .sort((left, right) => left.summary.title.localeCompare(right.summary.title));

  return {
    docs,
    totalChunkCount: docs.reduce((sum, entry) => sum + entry.summary.chunkCount, 0),
    sourceDocCounts,
    sourceChunkCounts,
    chunksPath,
  };
}

function compareChunkIds(left: string, right: string): number {
  const leftIndex = parseChunkOrdinal(left);
  const rightIndex = parseChunkOrdinal(right);

  if (leftIndex !== null && rightIndex !== null && leftIndex !== rightIndex) {
    return leftIndex - rightIndex;
  }

  return left.localeCompare(right);
}

function parseChunkOrdinal(chunkId: string): number | null {
  const pieces = chunkId.split("#");
  if (pieces.length !== 2) {
    return null;
  }

  const parsed = Number.parseInt(pieces[1], 10);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return parsed;
}

function normalizeSource(source: string | undefined, url: string): string {
  const normalized = source?.trim().toLowerCase();

  if (normalized === "support" || normalized === "support.clever.com" || normalized === "support-clever") {
    return "support";
  }

  if (normalized === "dev" || normalized === "dev.clever.com" || normalized === "dev-clever") {
    return "dev";
  }

  return inferSourceFromUrl(url);
}

function inferSourceFromUrl(url: string): string {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (hostname === "support.clever.com") {
      return "support";
    }
    if (hostname === "dev.clever.com") {
      return "dev";
    }
    return hostname;
  } catch {
    return "unknown";
  }
}

function resolveSourceHost(sourceHost: string | undefined, url: string): string {
  if (typeof sourceHost === "string" && sourceHost.trim().length > 0) {
    return sourceHost.trim().toLowerCase();
  }

  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "unknown";
  }
}
