import { calculateCost } from "@/lib/models";
import { callProvider } from "@/lib/providers";
import { buildRagSystemPrompt, trimConversation } from "@/lib/rag";
import { retrieveTopChunks } from "@/lib/retrieval";
import { getRetrievalMultiplierMap } from "@/lib/retrieval-weighting";
import { ApiError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { estimateMaxTurnCostCents, reserveBudget, usdToCentsCeil } from "@/lib/wallet";
import type { PreparedChatRequest } from "./prepare-request";

export interface ChatTurnExecution {
  providerResult: Awaited<ReturnType<typeof callProvider>>;
  measuredCost: ReturnType<typeof calculateCost>;
  actualCostCents: number;
  reservedBudgetCents: number;
  retrieval: Awaited<ReturnType<typeof retrieveTopChunks>>;
  systemPrompt: string;
  trimmedMessages: { role: string; content: string }[];
}

export async function executeChatTurn(
  prepared: PreparedChatRequest,
  sources?: string[]
): Promise<ChatTurnExecution> {
  const history = await prisma.message.findMany({
    where: {
      threadId: prepared.thread.id,
    },
    orderBy: {
      createdAt: "asc",
    },
    take: 24,
    select: {
      role: true,
      content: true,
    },
  });

  const conversation = history
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => ({
      role: message.role,
      content: message.content,
    }));

  const multipliers = await getRetrievalMultiplierMap();
  const retrieval = await retrieveTopChunks(prepared.userMessage.content, prepared.topK, multipliers, {
    sources,
  });
  const systemPrompt = buildRagSystemPrompt(retrieval);
  const trimmedMessages = trimConversation(conversation);

  const costEstimate = estimateMaxTurnCostCents({
    modelId: prepared.modelId,
    modelSpec: prepared.modelSpec,
    systemPrompt,
    messages: trimmedMessages,
    maxOutputTokens: prepared.maxOutputTokens,
  });

  let reservedBudgetCents = 0;
  if (!prepared.usingPersonalApiKey) {
    await reserveBudget({
      userId: prepared.thread.createdByUserId,
      amountCents: costEstimate.estimatedCostCents,
      requestId: prepared.requestId,
      threadId: prepared.thread.id,
      modelId: prepared.modelId,
      provider: prepared.parsedModel.provider,
      metadata: {
        inputTokensEstimate: costEstimate.inputTokensEstimate,
        outputTokensEstimate: costEstimate.outputTokensEstimate,
        pricingTier: costEstimate.pricingTier,
      },
    });
    reservedBudgetCents = costEstimate.estimatedCostCents;
  }

  let providerResult: Awaited<ReturnType<typeof callProvider>>;
  try {
    providerResult = await callProvider({
      modelId: prepared.modelId,
      messages: trimmedMessages,
      systemPrompt,
      temperature: prepared.temperature,
      maxOutputTokens: prepared.maxOutputTokens,
      apiKeyOverride: prepared.apiKeyOverride,
    });
  } catch {
    throw new ApiError(502, "Model provider request failed.", "provider_request_failed");
  }

  const measuredCost = calculateCost(providerResult.usage, prepared.modelId, prepared.modelSpec);
  const actualCostCents = prepared.usingPersonalApiKey ? 0 : usdToCentsCeil(measuredCost.totalCostUsd);

  return {
    providerResult,
    measuredCost,
    actualCostCents,
    reservedBudgetCents,
    retrieval,
    systemPrompt,
    trimmedMessages,
  };
}
