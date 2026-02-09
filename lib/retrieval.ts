import fs from "node:fs/promises";
import path from "node:path";

export interface ChunkRecord {
  chunk_id: string;
  doc_id: string;
  url: string;
  title: string;
  section?: string | null;
  heading_path?: string[];
  text: string;
  tokens_estimate?: number;
  breadcrumbs?: string[];
  tags?: string[];
}

interface IndexedChunk extends ChunkRecord {
  cleanedText: string;
  termFreq: Map<string, number>;
  docLength: number;
  titleTerms: Set<string>;
  searchableTitle: string;
  searchableText: string;
}

interface ChunkIndex {
  chunks: IndexedChunk[];
  docFreq: Map<string, number>;
  avgDocLength: number;
  articleCount: number;
  chunkCount: number;
  chunksPath: string;
}

export interface RetrievalResult {
  chunk: ChunkRecord;
  score: number;
  matchedTerms: string[];
  snippet: string;
}

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "how",
  "i",
  "if",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "was",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "with",
  "you",
  "your",
]);

const BM25_K1 = 1.2;
const BM25_B = 0.75;

let indexPromise: Promise<ChunkIndex> | null = null;

export function getChunksPath(): string {
  if (process.env.CHUNKS_PATH) {
    return path.resolve(process.env.CHUNKS_PATH);
  }
  return path.join(process.cwd(), "data", "chunks.jsonl");
}

export async function getChunkIndex(): Promise<ChunkIndex> {
  if (!indexPromise) {
    indexPromise = buildChunkIndex();
  }
  return indexPromise;
}

export async function getChunkStats(): Promise<{
  articleCount: number;
  chunkCount: number;
  chunksPath: string;
}> {
  const index = await getChunkIndex();
  return {
    articleCount: index.articleCount,
    chunkCount: index.chunkCount,
    chunksPath: index.chunksPath,
  };
}

export async function retrieveTopChunks(query: string, limit = 6): Promise<RetrievalResult[]> {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }

  const index = await getChunkIndex();
  const queryTerms = dedupe(tokenize(trimmed));
  const queryLower = trimmed.toLowerCase();

  if (!queryTerms.length) {
    return [];
  }

  const scored: Array<RetrievalResult> = [];
  const corpusSize = index.chunkCount;

  for (const chunk of index.chunks) {
    let score = 0;
    const matchedTerms: string[] = [];

    for (const term of queryTerms) {
      const tf = chunk.termFreq.get(term) ?? 0;
      if (tf <= 0) {
        continue;
      }

      const df = index.docFreq.get(term) ?? 0;
      const idf = Math.log(1 + (corpusSize - df + 0.5) / (df + 0.5));
      const denominator = tf + BM25_K1 * (1 - BM25_B + BM25_B * (chunk.docLength / index.avgDocLength));
      const termScore = idf * ((tf * (BM25_K1 + 1)) / denominator);
      score += termScore;
      matchedTerms.push(term);

      if (chunk.titleTerms.has(term)) {
        score += idf * 0.8;
      }
    }

    if (!matchedTerms.length) {
      continue;
    }

    if (chunk.searchableTitle.includes(queryLower)) {
      score += 2.5;
    }

    if (chunk.searchableText.includes(queryLower)) {
      score += 1.2;
    }

    scored.push({
      chunk,
      score,
      matchedTerms,
      snippet: buildSnippet(chunk.cleanedText, queryTerms),
    });
  }

  scored.sort((a, b) => b.score - a.score);

  // Keep source diversity first, then backfill with next-best chunks if needed.
  const byUrl = new Set<string>();
  const diverseResults: RetrievalResult[] = [];
  const fallbackResults: RetrievalResult[] = [];

  for (const item of scored) {
    if (!byUrl.has(item.chunk.url) && diverseResults.length < limit) {
      byUrl.add(item.chunk.url);
      diverseResults.push(item);
      continue;
    }

    fallbackResults.push(item);
  }

  if (diverseResults.length >= limit) {
    return diverseResults;
  }

  const merged = [...diverseResults];
  for (const item of fallbackResults) {
    merged.push(item);
    if (merged.length >= limit) {
      break;
    }
  }

  return merged;
}

async function buildChunkIndex(): Promise<ChunkIndex> {
  const chunksPath = getChunksPath();
  const raw = await fs.readFile(chunksPath, "utf8");
  const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);

  const chunks: IndexedChunk[] = [];
  const docFreq = new Map<string, number>();
  const articleIds = new Set<string>();
  let totalDocLength = 0;

  for (const line of lines) {
    let parsed: ChunkRecord;
    try {
      parsed = JSON.parse(line) as ChunkRecord;
    } catch {
      continue;
    }

    if (!parsed.chunk_id || !parsed.url || !parsed.title || !parsed.text) {
      continue;
    }

    const cleanedText = cleanChunkText(parsed.text);
    const searchableTitle = parsed.title.toLowerCase();
    const searchableText = cleanedText.toLowerCase();
    const combined = `${parsed.title}\n${parsed.section ?? ""}\n${cleanedText}`;
    const terms = tokenize(combined);
    const termFreq = countTerms(terms);
    const uniqueTerms = new Set(terms);

    for (const term of uniqueTerms) {
      docFreq.set(term, (docFreq.get(term) ?? 0) + 1);
    }

    const docLength = Math.max(1, terms.length);
    totalDocLength += docLength;
    articleIds.add(parsed.doc_id);

    chunks.push({
      ...parsed,
      cleanedText,
      searchableTitle,
      searchableText,
      termFreq,
      docLength,
      titleTerms: new Set(tokenize(parsed.title)),
    });
  }

  const chunkCount = chunks.length;
  const avgDocLength = Math.max(1, totalDocLength / Math.max(1, chunkCount));

  return {
    chunks,
    docFreq,
    avgDocLength,
    articleCount: articleIds.size,
    chunkCount,
    chunksPath,
  };
}

function cleanChunkText(text: string): string {
  return text
    .replace(/^>\s?/gm, "")
    .replace(/\u00a0/g, " ")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function tokenize(text: string): string[] {
  const normalized = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s]/g, " ");

  return normalized
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

function countTerms(terms: string[]): Map<string, number> {
  const freq = new Map<string, number>();
  for (const term of terms) {
    freq.set(term, (freq.get(term) ?? 0) + 1);
  }
  return freq;
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

function buildSnippet(text: string, queryTerms: string[]): string {
  const lower = text.toLowerCase();
  let firstHit = -1;

  for (const term of queryTerms) {
    const idx = lower.indexOf(term);
    if (idx !== -1 && (firstHit === -1 || idx < firstHit)) {
      firstHit = idx;
    }
  }

  if (firstHit === -1) {
    const compact = compactWhitespace(text);
    return compact.length > 220 ? `${compact.slice(0, 220)}...` : compact;
  }

  const windowSize = 280;
  const start = Math.max(0, firstHit - 90);
  const end = Math.min(text.length, start + windowSize);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < text.length ? "..." : "";
  return `${prefix}${compactWhitespace(text.slice(start, end))}${suffix}`;
}

function compactWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
