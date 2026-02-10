import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireDbUser: vi.fn(),
  messageFindUnique: vi.fn(),
  messageFeedbackUpsert: vi.fn(),
  recomputeSignals: vi.fn(),
  queueCandidate: vi.fn(),
}));

vi.mock("@/lib/server-auth", () => ({
  requireDbUser: mocks.requireDbUser,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    message: {
      findUnique: mocks.messageFindUnique,
    },
    messageFeedback: {
      upsert: mocks.messageFeedbackUpsert,
    },
  },
}));

vi.mock("@/lib/retrieval-weighting", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/retrieval-weighting")>();
  return {
    ...actual,
    recomputeRetrievalSignalsForChunks: mocks.recomputeSignals,
  };
});

vi.mock("@/lib/ingestion", () => ({
  queueMessageIngestionCandidate: mocks.queueCandidate,
  summarizeFeedbackCandidate: () => "summary",
}));

import { POST } from "@/app/api/messages/[id]/feedback/route";
import { calculateRetrievalMultiplier } from "@/lib/retrieval-weighting";

describe("message feedback and weighting", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.requireDbUser.mockResolvedValue({
      id: "user-1",
    });

    mocks.messageFindUnique.mockResolvedValue({
      id: "message-1",
      threadId: "thread-1",
      content: "Assistant answer",
      thread: {
        visibility: "org",
        createdByUserId: "user-2",
        participants: [],
      },
      citations: [{ chunkId: "chunk-1" }, { chunkId: "chunk-2" }],
    });

    mocks.messageFeedbackUpsert.mockResolvedValue({
      id: "feedback-1",
      rating: 4,
      comment: "helpful",
    });
  });

  it("writes feedback and recalculates retrieval signals", async () => {
    const request = new Request("http://localhost/api/messages/message-1/feedback", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        rating: 1,
        comment: "not accurate",
      }),
    });

    const response = await POST(request, {
      params: Promise.resolve({ id: "message-1" }),
    });

    expect(response.status).toBe(200);
    expect(mocks.messageFeedbackUpsert).toHaveBeenCalledTimes(1);
    expect(mocks.recomputeSignals).toHaveBeenCalledWith(["chunk-1", "chunk-2"]);
    expect(mocks.queueCandidate).not.toHaveBeenCalled();
  });

  it("queues ingestion candidate for high rating", async () => {
    const request = new Request("http://localhost/api/messages/message-1/feedback", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        rating: 5,
        comment: "great response",
      }),
    });

    const response = await POST(request, {
      params: Promise.resolve({ id: "message-1" }),
    });

    expect(response.status).toBe(200);
    expect(mocks.queueCandidate).toHaveBeenCalledTimes(1);
  });

  it("penalizes low-rated chunks and boosts high-rated chunks conservatively", () => {
    const low = calculateRetrievalMultiplier({
      avgRating: 1.5,
      ratingCount: 10,
      lowRatingCount: 8,
      highRatingCount: 0,
    });

    const high = calculateRetrievalMultiplier({
      avgRating: 4.7,
      ratingCount: 10,
      lowRatingCount: 0,
      highRatingCount: 8,
    });

    expect(low.multiplier).toBeLessThan(1);
    expect(high.multiplier).toBeGreaterThan(1);
    expect(low.multiplier).toBeGreaterThanOrEqual(0.7);
    expect(high.multiplier).toBeLessThanOrEqual(1.2);
  });
});
