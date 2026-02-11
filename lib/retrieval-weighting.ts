import { prisma } from "@/lib/db/prisma";

const MAX_MULTIPLIER = 1.2;
const MIN_MULTIPLIER = 0.7;
const STRONG_SIGNAL_THRESHOLD = 8;
const LIGHT_SIGNAL_THRESHOLD = 3;
const SIGNAL_CACHE_TTL_MS = 30_000;

let cachedMultiplierMap: Map<string, number> | null = null;
let cachedAt = 0;

export interface RetrievalSignalStats {
  ratingCount: number;
  avgRating: number;
  lowRatingCount: number;
  highRatingCount: number;
  confidence: number;
  multiplier: number;
}

/**
 * Conservative signal weighting:
 * 1) start from average rating impact around neutral 3.0
 * 2) scale by confidence so low-sample data has small effect
 * 3) apply extra low/high ratio adjustment
 * 4) clamp to stable bounds so retrieval remains diverse
 */
export function calculateRetrievalMultiplier(input: {
  avgRating: number;
  ratingCount: number;
  lowRatingCount: number;
  highRatingCount: number;
}): RetrievalSignalStats {
  const ratingCount = Math.max(0, Math.round(input.ratingCount));

  if (ratingCount === 0) {
    return {
      ratingCount: 0,
      avgRating: 0,
      lowRatingCount: 0,
      highRatingCount: 0,
      confidence: 0,
      multiplier: 1,
    };
  }

  const avgRating = clamp(input.avgRating, 1, 5);
  const lowRatingCount = clampInt(input.lowRatingCount, 0, ratingCount);
  const highRatingCount = clampInt(input.highRatingCount, 0, ratingCount);

  const confidenceRaw = Math.min(1, ratingCount / STRONG_SIGNAL_THRESHOLD);
  const confidence = ratingCount < LIGHT_SIGNAL_THRESHOLD ? confidenceRaw * 0.5 : confidenceRaw;

  const baseFromAvg = ((avgRating - 3) / 2) * 0.2;
  const lowPenalty = (lowRatingCount / ratingCount) * 0.18;
  const highBoost = (highRatingCount / ratingCount) * 0.08;
  const rawAdjustment = (baseFromAvg - lowPenalty + highBoost) * confidence;

  const multiplier = clamp(1 + rawAdjustment, MIN_MULTIPLIER, MAX_MULTIPLIER);

  return {
    ratingCount,
    avgRating,
    lowRatingCount,
    highRatingCount,
    confidence: Number(confidence.toFixed(4)),
    multiplier: Number(multiplier.toFixed(4)),
  };
}

export async function getRetrievalMultiplierMap(): Promise<Map<string, number>> {
  if (cachedMultiplierMap && Date.now() - cachedAt <= SIGNAL_CACHE_TTL_MS) {
    return cachedMultiplierMap;
  }

  const signals = await prisma.retrievalSignal.findMany({
    select: {
      chunkId: true,
      multiplier: true,
    },
  });

  const map = new Map<string, number>();
  for (const signal of signals) {
    map.set(signal.chunkId, signal.multiplier);
  }

  cachedMultiplierMap = map;
  cachedAt = Date.now();
  return map;
}

export async function recomputeRetrievalSignalsForChunks(chunkIds: string[]): Promise<void> {
  const uniqueChunkIds = [...new Set(chunkIds.map((chunkId) => chunkId.trim()).filter((chunkId) => chunkId.length > 0))];
  if (uniqueChunkIds.length === 0) {
    return;
  }

  for (const chunkId of uniqueChunkIds) {
    const [messageRatings, threadRatings, latestCitation] = await Promise.all([
      prisma.messageFeedback.findMany({
        where: {
          message: {
            citations: {
              some: {
                chunkId,
              },
            },
          },
        },
        select: {
          rating: true,
        },
      }),
      prisma.threadFeedback.findMany({
        where: {
          thread: {
            messages: {
              some: {
                citations: {
                  some: {
                    chunkId,
                  },
                },
              },
            },
          },
        },
        select: {
          rating: true,
        },
      }),
      prisma.messageCitation.findFirst({
        where: {
          chunkId,
        },
        orderBy: {
          createdAt: "desc",
        },
        select: {
          docId: true,
        },
      }),
    ]);

    const combinedRatings = [
      ...messageRatings.map((item) => item.rating),
      ...threadRatings.map((item) => item.rating),
    ];

    if (combinedRatings.length === 0) {
      await prisma.retrievalSignal.deleteMany({
        where: {
          chunkId,
        },
      });
      continue;
    }

    const sum = combinedRatings.reduce((acc, value) => acc + value, 0);
    const avgRating = sum / combinedRatings.length;
    const lowRatingCount = combinedRatings.filter((value) => value <= 2).length;
    const highRatingCount = combinedRatings.filter((value) => value >= 4).length;

    const signal = calculateRetrievalMultiplier({
      avgRating,
      ratingCount: combinedRatings.length,
      lowRatingCount,
      highRatingCount,
    });

    await prisma.retrievalSignal.upsert({
      where: {
        chunkId,
      },
      create: {
        chunkId,
        docId: latestCitation?.docId ?? null,
        ratingCount: signal.ratingCount,
        avgRating: signal.avgRating,
        lowRatingCount: signal.lowRatingCount,
        highRatingCount: signal.highRatingCount,
        confidence: signal.confidence,
        multiplier: signal.multiplier,
      },
      update: {
        docId: latestCitation?.docId ?? null,
        ratingCount: signal.ratingCount,
        avgRating: signal.avgRating,
        lowRatingCount: signal.lowRatingCount,
        highRatingCount: signal.highRatingCount,
        confidence: signal.confidence,
        multiplier: signal.multiplier,
      },
    });
  }

  cachedMultiplierMap = null;
  cachedAt = 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, Math.round(value)));
}
