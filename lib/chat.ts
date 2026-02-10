import { randomUUID } from "node:crypto";
import type { ApiKeyProvider } from "@prisma/client";
import { calculateCost, DEFAULT_MODEL_ID, findModelSpec, MODEL_SPECS, parseModelId } from "@/lib/models";
import { callProvider } from "@/lib/providers";
import { buildRagSystemPrompt, trimConversation } from "@/lib/rag";
import { retrieveTopChunks } from "@/lib/retrieval";
import { getRetrievalMultiplierMap } from "@/lib/retrieval-weighting";
import { getDynamicServerModelCatalog, hasConfiguredServerKey, resolveServerModelId } from "@/lib/server-models";
import { ApiError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { assertThreadAccess, deriveThreadTitleFromContent } from "@/lib/threads";
import { decryptApiKeyWithMetadata, encryptApiKey, maskApiKey } from "@/lib/user-api-keys";
import {
  estimateMaxTurnCostCents,
  finalizeReservedSpend,
  releaseReservation,
  reserveBudget,
  usdToCentsCeil,
} from "@/lib/wallet";
import { logUserApiKeyAuditEvent } from "@/lib/byok-audit";

export interface RunChatTurnInput {
  userId: string;
  threadId: string;
  content: string;
  sources?: string[];
  modelId?: string;
  topK?: number;
  temperature?: number;
  maxOutputTokens?: number;
  userApiKeyId?: string;
}

export async function runChatTurn(input: RunChatTurnInput) {
  const thread = await prisma.thread.findUnique({
    where: {
      id: input.threadId,
    },
    include: {
      participants: {
        select: {
          userId: true,
        },
      },
    },
  });

  if (!thread) {
    throw new ApiError(404, "Thread not found", "thread_not_found");
  }

  assertThreadAccess({
    thread: {
      visibility: thread.visibility,
      createdByUserId: thread.createdByUserId,
      participants: thread.participants,
    },
    userId: input.userId,
  });

  const userContent = input.content.trim();
  if (userContent.length === 0) {
    throw new ApiError(400, "Message content is required.", "missing_content");
  }
  const requestId = randomUUID();

  const userMessage = await prisma.message.create({
    data: {
      threadId: thread.id,
      userId: input.userId,
      role: "user",
      content: userContent,
    },
    select: {
      id: true,
      content: true,
      createdAt: true,
    },
  });

  const allowClientApiKeyOverride = process.env.ALLOW_CLIENT_API_KEY_OVERRIDE === "true";
  const discoveredModelCatalog = await getDynamicServerModelCatalog({ allowClientApiKeyOverride });
  const modelCatalog = discoveredModelCatalog.length > 0 ? discoveredModelCatalog : MODEL_SPECS;
  if (modelCatalog.length === 0) {
    throw new ApiError(500, "No models are configured on the server.", "no_models");
  }

  const requestedModelId = input.modelId?.trim() || undefined;
  if (requestedModelId) {
    const parsedRequestedModel = parseModelId(requestedModelId);
    if (!parsedRequestedModel) {
      throw new ApiError(400, "Invalid model ID format.", "invalid_model_id");
    }

    if (!modelCatalog.some((model) => model.id === requestedModelId)) {
      throw new ApiError(400, "Unsupported model ID.", "unsupported_model_id");
    }
  }

  const modelId = resolveServerModelId(requestedModelId, modelCatalog, DEFAULT_MODEL_ID);
  if (!modelId) {
    throw new ApiError(500, "Unable to resolve an active model.", "model_resolution_failed");
  }

  const modelSpec = modelCatalog.find((model) => model.id === modelId) ?? findModelSpec(modelId);
  const parsedModel = parseModelId(modelId);
  if (!parsedModel) {
    throw new ApiError(400, "Invalid model ID format.", "invalid_model_id");
  }

  const selectedUserApiKeyId = input.userApiKeyId?.trim() || null;
  let selectedUserApiKeyProvider: ApiKeyProvider | null = null;
  let userApiKeyUseAuditLogged = false;
  let apiKeyOverride: string | undefined;
  let usingPersonalApiKey = false;
  if (selectedUserApiKeyId) {
    const selectedKey = await prisma.userApiKey.findFirst({
      where: {
        id: selectedUserApiKeyId,
        userId: input.userId,
      },
      select: {
        provider: true,
        encryptedKey: true,
      },
    });

    if (!selectedKey) {
      await logUserApiKeyAuditEvent({
        actorUserId: input.userId,
        action: "user_api_key.use",
        targetId: selectedUserApiKeyId,
        provider: parsedModel.provider,
        result: "failure",
        requestId,
        reasonCode: "invalid_user_api_key",
      });
      userApiKeyUseAuditLogged = true;
      throw new ApiError(400, "Selected personal key was not found.", "invalid_user_api_key");
    }
    selectedUserApiKeyProvider = selectedKey.provider;

    if (selectedKey.provider !== parsedModel.provider) {
      await logUserApiKeyAuditEvent({
        actorUserId: input.userId,
        action: "user_api_key.use",
        targetId: selectedUserApiKeyId,
        provider: selectedKey.provider,
        result: "failure",
        requestId,
        reasonCode: "user_api_key_provider_mismatch",
      });
      userApiKeyUseAuditLogged = true;
      throw new ApiError(
        400,
        `Selected key is for ${selectedKey.provider}, but model ${modelId} requires ${parsedModel.provider}.`,
        "user_api_key_provider_mismatch"
      );
    }

    let decryptedKey: ReturnType<typeof decryptApiKeyWithMetadata>;
    try {
      decryptedKey = decryptApiKeyWithMetadata(selectedKey.encryptedKey);
    } catch (error) {
      await logUserApiKeyAuditEvent({
        actorUserId: input.userId,
        action: "user_api_key.use",
        targetId: selectedUserApiKeyId,
        provider: selectedKey.provider,
        result: "failure",
        requestId,
        reasonCode: auditReasonCodeFromError(error),
      });
      userApiKeyUseAuditLogged = true;
      throw error;
    }
    apiKeyOverride = decryptedKey.apiKey;
    usingPersonalApiKey = true;

    if (decryptedKey.shouldReencrypt) {
      await prisma.userApiKey.updateMany({
        where: {
          id: selectedUserApiKeyId,
          userId: input.userId,
        },
        data: {
          encryptedKey: encryptApiKey(decryptedKey.apiKey),
          keyPreview: maskApiKey(decryptedKey.apiKey),
        },
      });
    }
  } else if (!hasConfiguredServerKey(parsedModel.provider)) {
    throw new ApiError(400, `No server API key is configured for ${parsedModel.provider}.`, "missing_provider_key");
  }

  const topK = clampNumber(input.topK, 2, 10, 6);
  const temperature = clampNumber(input.temperature, 0, 1.2, 0.2);
  const maxOutputTokens = Math.round(clampNumber(input.maxOutputTokens, 128, 4096, 1200));

  const history = await prisma.message.findMany({
    where: {
      threadId: thread.id,
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
  const retrieval = await retrieveTopChunks(userContent, topK, multipliers, {
    sources: input.sources,
  });
  const systemPrompt = buildRagSystemPrompt(retrieval);
  const trimmedMessages = trimConversation(conversation);

  const costEstimate = estimateMaxTurnCostCents({
    modelId,
    modelSpec: modelSpec,
    systemPrompt,
    messages: trimmedMessages,
    maxOutputTokens,
  });

  let reservedBudgetCents = 0;
  if (!usingPersonalApiKey) {
    await reserveBudget({
      userId: input.userId,
      amountCents: costEstimate.estimatedCostCents,
      requestId,
      threadId: thread.id,
      modelId,
      provider: parsedModel.provider,
      metadata: {
        inputTokensEstimate: costEstimate.inputTokensEstimate,
        outputTokensEstimate: costEstimate.outputTokensEstimate,
        pricingTier: costEstimate.pricingTier,
      },
    });
    reservedBudgetCents = costEstimate.estimatedCostCents;
  }

  try {
    let providerResult: Awaited<ReturnType<typeof callProvider>>;
    try {
      providerResult = await callProvider({
        modelId,
        messages: trimmedMessages,
        systemPrompt,
        temperature,
        maxOutputTokens,
        apiKeyOverride,
      });
    } catch {
      throw new ApiError(502, "Model provider request failed.", "provider_request_failed");
    }

    const measuredCost = calculateCost(providerResult.usage, modelId, modelSpec);
    const actualCostCents = usingPersonalApiKey ? 0 : usdToCentsCeil(measuredCost.totalCostUsd);

    if (usingPersonalApiKey && selectedUserApiKeyId && selectedUserApiKeyProvider && !userApiKeyUseAuditLogged) {
      await logUserApiKeyAuditEvent({
        actorUserId: input.userId,
        action: "user_api_key.use",
        targetId: selectedUserApiKeyId,
        provider: selectedUserApiKeyProvider,
        result: "success",
        requestId,
      });
      userApiKeyUseAuditLogged = true;
    }

    const now = new Date();
    const title = thread.title === "New thread" ? deriveThreadTitleFromContent(userContent) : thread.title;

    const assistantMessage = await prisma.$transaction(async (tx) => {
      const createdMessage = await tx.message.create({
        data: {
          threadId: thread.id,
          userId: null,
          role: "assistant",
          content: providerResult.text,
          modelId,
          provider: providerResult.provider,
          usage: {
            ...providerResult.usage,
            billingMode: usingPersonalApiKey ? "personal_key" : "house_key",
            estimatedReservationCents: reservedBudgetCents,
            measuredCostUsd: measuredCost.totalCostUsd,
            measuredInputCostUsd: measuredCost.inputCostUsd,
            measuredOutputCostUsd: measuredCost.outputCostUsd,
            measuredHasPricing: measuredCost.hasPricing,
          },
          costCents: actualCostCents,
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

      if (retrieval.length > 0) {
        await tx.messageCitation.createMany({
          data: retrieval.map((item) => ({
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
          id: thread.id,
        },
        data: {
          title,
          updatedAt: now,
        },
      });

      return createdMessage;
    });

    let budget = {
      reservedCents: reservedBudgetCents,
      chargedCents: 0,
      releasedCents: 0,
      remainingBalanceCents: 0,
    };

    if (usingPersonalApiKey) {
      const wallet = await prisma.wallet.findUnique({
        where: {
          userId: input.userId,
        },
        select: {
          balanceCents: true,
        },
      });
      budget.remainingBalanceCents = wallet?.balanceCents ?? 0;
    } else {
      const settled = await finalizeReservedSpend({
        userId: input.userId,
        reservedCents: reservedBudgetCents,
        actualCostCents,
        requestId,
        threadId: thread.id,
        messageId: assistantMessage.id,
        modelId,
        provider: providerResult.provider,
        metadata: {
          pricingTier: measuredCost.pricingTier,
          hasPricing: measuredCost.hasPricing,
        },
      });
      budget = {
        reservedCents: reservedBudgetCents,
        chargedCents: settled.debitedCents,
        releasedCents: settled.releasedCents,
        remainingBalanceCents: settled.remainingBalanceCents,
      };
    }

    const citations = retrieval.map((item, index) => ({
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
      threadId: thread.id,
      userMessage,
      assistant: {
        id: assistantMessage.id,
        role: "assistant" as const,
        content: assistantMessage.content,
        createdAt: assistantMessage.createdAt,
        usage: providerResult.usage,
        cost: measuredCost,
        costCents: actualCostCents,
        modelId,
        provider: providerResult.provider,
        citations,
      },
      budget: {
        ...budget,
      },
      retrieval: {
        count: citations.length,
        topK,
      },
    };
  } catch (error) {
    if (usingPersonalApiKey && selectedUserApiKeyId && selectedUserApiKeyProvider && !userApiKeyUseAuditLogged) {
      await logUserApiKeyAuditEvent({
        actorUserId: input.userId,
        action: "user_api_key.use",
        targetId: selectedUserApiKeyId,
        provider: selectedUserApiKeyProvider,
        result: "failure",
        requestId,
        reasonCode: auditReasonCodeFromError(error),
      });
      userApiKeyUseAuditLogged = true;
    }

    if (!usingPersonalApiKey && reservedBudgetCents > 0) {
      await releaseReservation({
        userId: input.userId,
        reservedCents: reservedBudgetCents,
        requestId,
        threadId: thread.id,
        modelId,
        provider: parsedModel.provider,
        metadata: {
          reason: "provider_error",
          code: error instanceof ApiError && error.code ? error.code : "provider_request_failed",
        },
      });
    }
    throw error;
  }
}

function clampNumber(value: number | undefined, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, value));
}

function auditReasonCodeFromError(error: unknown): string {
  if (error instanceof ApiError && error.code) {
    return error.code;
  }

  if (error instanceof Error && "code" in error && typeof (error as { code?: unknown }).code === "string") {
    return (error as { code: string }).code;
  }

  return "unexpected_error";
}
