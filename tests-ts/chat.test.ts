import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const txMessageCreate = vi.fn();
  const txCitationCreateMany = vi.fn();
  const txThreadUpdate = vi.fn();

  return {
    threadFindUnique: vi.fn(),
    messageCreate: vi.fn(),
    messageFindMany: vi.fn(),
    prismaTransaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        message: {
          create: txMessageCreate,
        },
        messageCitation: {
          createMany: txCitationCreateMany,
        },
        thread: {
          update: txThreadUpdate,
        },
      })
    ),
    txMessageCreate,
    txCitationCreateMany,
    txThreadUpdate,

    estimateMaxTurnCostCents: vi.fn(),
    reserveBudget: vi.fn(),
    finalizeReservedSpend: vi.fn(),
    releaseReservation: vi.fn(),
    usdToCentsCeil: vi.fn(),

    callProvider: vi.fn(),
    retrieveTopChunks: vi.fn(),
    getRetrievalMultiplierMap: vi.fn(),
  };
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    thread: {
      findUnique: mocks.threadFindUnique,
    },
    message: {
      create: mocks.messageCreate,
      findMany: mocks.messageFindMany,
    },
    $transaction: mocks.prismaTransaction,
  },
}));

vi.mock("@/lib/wallet", () => ({
  estimateMaxTurnCostCents: mocks.estimateMaxTurnCostCents,
  reserveBudget: mocks.reserveBudget,
  finalizeReservedSpend: mocks.finalizeReservedSpend,
  releaseReservation: mocks.releaseReservation,
  usdToCentsCeil: mocks.usdToCentsCeil,
}));

vi.mock("@/lib/providers", () => ({
  callProvider: mocks.callProvider,
}));

vi.mock("@/lib/retrieval", () => ({
  retrieveTopChunks: mocks.retrieveTopChunks,
}));

vi.mock("@/lib/retrieval-weighting", () => ({
  getRetrievalMultiplierMap: mocks.getRetrievalMultiplierMap,
}));

vi.mock("@/lib/server-models", () => ({
  getDynamicServerModelCatalog: async () => [
    {
      id: "openai:gpt-5-mini",
      provider: "openai",
      apiModel: "gpt-5-mini",
      label: "GPT-5 mini",
      description: "test",
      inputPerMillionUsd: 0.25,
      outputPerMillionUsd: 2,
    },
  ],
  hasConfiguredServerKey: () => true,
  resolveServerModelId: (requested: string | undefined) => requested ?? "openai:gpt-5-mini",
}));

vi.mock("@/lib/rag", () => ({
  buildRagSystemPrompt: () => "system prompt",
  trimConversation: (messages: Array<{ role: string; content: string }>) => messages,
}));

import { runChatTurn } from "@/lib/chat";

describe("runChatTurn", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.threadFindUnique.mockResolvedValue({
      id: "thread-1",
      title: "New thread",
      visibility: "org",
      createdByUserId: "user-1",
      participants: [],
    });

    mocks.messageCreate.mockResolvedValue({
      id: "msg-user-1",
      content: "How do I request an app?",
      createdAt: new Date("2026-02-09T00:00:00.000Z"),
    });

    mocks.messageFindMany.mockResolvedValue([
      {
        role: "user",
        content: "How do I request an app?",
      },
    ]);

    mocks.getRetrievalMultiplierMap.mockResolvedValue(new Map());
    mocks.retrieveTopChunks.mockResolvedValue([
      {
        chunk: {
          chunk_id: "chunk-1",
          doc_id: "doc-1",
          url: "https://support.clever.com/article/1",
          title: "Requesting apps",
          section: "Overview",
          text: "Go to Library and click Request.",
        },
        score: 3.1,
        snippet: "Go to Library and click Request.",
        matchedTerms: ["request"],
        multiplierApplied: 1,
      },
    ]);

    mocks.estimateMaxTurnCostCents.mockReturnValue({
      estimatedCostCents: 25,
      inputTokensEstimate: 100,
      outputTokensEstimate: 200,
      pricingTier: "standard",
    });

    mocks.reserveBudget.mockResolvedValue({
      remainingBalanceCents: 175,
    });

    mocks.callProvider.mockResolvedValue({
      modelId: "openai:gpt-5-mini",
      provider: "openai",
      apiModel: "gpt-5-mini",
      text: "Use Library > Request App.",
      usage: {
        inputTokens: 120,
        outputTokens: 90,
        totalTokens: 210,
      },
    });

    mocks.usdToCentsCeil.mockReturnValue(12);

    mocks.txMessageCreate.mockResolvedValue({
      id: "msg-assistant-1",
      content: "Use Library > Request App.",
      createdAt: new Date("2026-02-09T00:01:00.000Z"),
      modelId: "openai:gpt-5-mini",
      provider: "openai",
      usage: { totalTokens: 210 },
      costCents: 12,
    });

    mocks.txCitationCreateMany.mockResolvedValue({ count: 1 });
    mocks.txThreadUpdate.mockResolvedValue({ id: "thread-1" });

    mocks.finalizeReservedSpend.mockResolvedValue({
      debitedCents: 12,
      releasedCents: 13,
      remainingBalanceCents: 188,
    });
  });

  it("persists user/assistant turns and finalizes wallet ledger", async () => {
    const result = await runChatTurn({
      userId: "user-1",
      threadId: "thread-1",
      content: "How do I request an app?",
      modelId: "openai:gpt-5-mini",
      topK: 4,
      temperature: 0.2,
      maxOutputTokens: 800,
    });

    expect(mocks.messageCreate).toHaveBeenCalledTimes(1);
    expect(mocks.txMessageCreate).toHaveBeenCalledTimes(1);
    expect(mocks.txCitationCreateMany).toHaveBeenCalledTimes(1);
    expect(mocks.reserveBudget).toHaveBeenCalledTimes(1);
    expect(mocks.finalizeReservedSpend).toHaveBeenCalledTimes(1);
    expect(result.assistant.id).toBe("msg-assistant-1");
    expect(result.budget.remainingBalanceCents).toBe(188);
    expect(result.assistant.citations).toHaveLength(1);
  });
});
