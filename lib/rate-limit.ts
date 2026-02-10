import { ApiError } from "@/lib/http";

interface RateLimitBucket {
  windowStartMs: number;
  count: number;
}

const buckets = new Map<string, RateLimitBucket>();
const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_LIMIT = 20;
const MAX_BUCKETS = 10_000;

export function enforceRateLimit(input: {
  scope: string;
  key: string;
  limit?: number;
  windowMs?: number;
}): void {
  const limit = input.limit ?? DEFAULT_LIMIT;
  const windowMs = input.windowMs ?? DEFAULT_WINDOW_MS;
  const now = Date.now();
  const bucketKey = `${input.scope}:${input.key}`;

  let bucket = buckets.get(bucketKey);
  if (!bucket || now - bucket.windowStartMs >= windowMs) {
    bucket = {
      windowStartMs: now,
      count: 0,
    };
  }

  bucket.count += 1;
  buckets.set(bucketKey, bucket);
  pruneBuckets(now, windowMs);

  if (bucket.count > limit) {
    throw new ApiError(429, "Too many requests. Try again shortly.", "rate_limited");
  }
}

function pruneBuckets(nowMs: number, windowMs: number): void {
  if (buckets.size <= MAX_BUCKETS) {
    return;
  }

  for (const [key, bucket] of buckets.entries()) {
    if (nowMs - bucket.windowStartMs >= windowMs * 2) {
      buckets.delete(key);
    }
  }
}

export function __resetRateLimitBucketsForTests(): void {
  buckets.clear();
}

