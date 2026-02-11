import { prisma } from "@/lib/prisma";
import { deriveThreadTitleFromContent } from "@/lib/threads";
import { finalizeReservedSpend } from "@/lib/wallet";
import { logUserApiKeyAuditEvent } from "@/lib/byok-audit";
import type { UsageMetrics } from "@/lib/types";
import type { PreparedChatRequest } from "./prepare-request";
import type { ChatTurnExecution } from "./execute-turn";

export interface ChatTurnResult {
  threadId: string;
  userMessage: {
    id: string;
    content: string;
    createdAt: Date;
  };
  assistant: {
    id: string;
    role: "assistant";
    content: string;
    createdAt: Date;
    usage: UsageMetrics;
    cost: {
      totalCostUsd: number;
      inputCostUsd: number;
      outputCostUsd: number;
      hasPricing: boolean;
      pricingTier: string | null;
    };
    costCents: number;
    modelId: string;
    provider: string;
    citations: Array<{
      index: number;
      chunkId: string;
      docId: string;
      title: string;
      url: string;
      section: string | null;
      score: number;
      snippet: string;
      multiplierApplied: number;
    }>;
  };
  budget: {
    reservedCents: number;
    chargedCents: number;
    releasedCents: number;
    remainingBalanceCents: number;
  };
  retrieval: {
    count: number;
    topK: number;
  };
}

export async function finalizeChatResponse(
  prepared: PreparedChatRequest,
  execution: ChatTurnExecution
): Promise<ChatTurnResult> {
  if (
    prepared.usingPersonalApiKey &&
    prepared.selectedUserApiKeyId &&
    prepared.selectedUserApiKeyProvider &&
    !prepared.userApiKeyUseAuditLogged
  ) {
    await logUserApiKeyAuditEvent({
      actorUserId: prepared.thread.createdByUserId,
      action: "user_api_key.use",
      targetId: prepared.selectedUserApiKeyId,
      provider: prepared.selectedUserApiKeyProvider,
      result: "success",
      requestId: prepared.requestId,
    });
  }

  const now = new Date();
  const title =
    prepared.thread.title === "New thread"
      ? deriveThreadTitleFromContent(prepared.userMessage.content)
      : prepared.thread.title;

  const assistantMessage = await prisma.$transaction(async (tx) => {
    const createdMessage = await tx.message.create({
      data: {
        threadId: prepared.thread.id,
        userId: null,
        role: "assistant",
        content: execution.providerResult.text,
        modelId: prepared.modelId,
        provider: execution.providerResult.provider,
        usage: {
          ...execution.providerResult.usage,
          billingMode: prepared.usingPersonalApiKey ? "personal_key" : "house_key",
          estimatedReservationCents: execution.reservedBudgetCents,
          measuredCostUsd: execution.measuredCost.totalCostUsd,
          measuredInputCostUsd: execution.measuredCost.inputCostUsd,
          measuredOutputCostUsd: execution.measuredCost.outputCostUsd,
          measuredHasPricing: execution.measuredCost.hasPricing,
        },
        costCents: execution.actualCostCents,
      },
      select: {
        id: true,
        content: true,
        createdAt: true,
        modelId: true,
        provider: true,
        usage: true,
        costCents: true,
      },
    });

    if (execution.retrieval.length > 0) {
      await tx.messageCitation.createMany({
        data: execution.retrieval.map((item) => ({
          messageId: createdMessage.id,
          chunkId: item.chunk.chunk_id,
          docId: item.chunk.doc_id,
          url: item.chunk.url,
          title: item.chunk.title,
          section: item.chunk.section ?? null,
          score: item.score,
          snippet: item.snippet,
        })),
      });
    }

    await tx.thread.update({
      where: {
        id: prepared.thread.id,
      },
      data: {
        title,
        updatedAt: now,
      },
    });

    return createdMessage;
  });

  let budget = {
    reservedCents: execution.reservedBudgetCents,
    chargedCents: 0,
    releasedCents: 0,
    remainingBalanceCents: 0,
  };

  if (prepared.usingPersonalApiKey) {
    const wallet = await prisma.wallet.findUnique({
      where: {
        userId: prepared.thread.createdByUserId,
      },
      select: {
        balanceCents: true,
      },
    });
    budget.remainingBalanceCents = wallet?.balanceCents ?? 0;
  } else {
    const settled = await finalizeReservedSpend({
      userId: prepared.thread.createdByUserId,
      reservedCents: execution.reservedBudgetCents,
      actualCostCents: execution.actualCostCents,
      requestId: prepared.requestId,
      threadId: prepared.thread.id,
      messageId: assistantMessage.id,
      modelId: prepared.modelId,
      provider: execution.providerResult.provider,
      metadata: {
        pricingTier: execution.measuredCost.pricingTier,
        hasPricing: execution.measuredCost.hasPricing,
      },
    });
    budget = {
      reservedCents: execution.reservedBudgetCents,
      chargedCents: settled.debitedCents,
      releasedCents: settled.releasedCents,
      remainingBalanceCents: settled.remainingBalanceCents,
    };
  }

  const citations = execution.retrieval.map((item, index) => ({
    index: index + 1,
    chunkId: item.chunk.chunk_id,
    docId: item.chunk.doc_id,
    title: item.chunk.title,
    url: item.chunk.url,
    section: item.chunk.section ?? null,
    score: Number(item.score.toFixed(4)),
    snippet: item.snippet,
    multiplierApplied: item.multiplierApplied,
  }));

  return {
    threadId: prepared.thread.id,
    userMessage: prepared.userMessage,
    assistant: {
      id: assistantMessage.id,
      role: "assistant" as const,
      content: assistantMessage.content,
      createdAt: assistantMessage.createdAt,
      usage: execution.providerResult.usage,
      cost: execution.measuredCost,
      costCents: execution.actualCostCents,
      modelId: prepared.modelId,
      provider: execution.providerResult.provider,
      citations,
    },
    budget: {
      ...budget,
    },
    retrieval: {
      count: citations.length,
      topK: prepared.topK,
    },
  };
}
