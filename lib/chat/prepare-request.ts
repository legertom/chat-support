import { randomUUID } from "node:crypto";
import type { ApiKeyProvider } from "@prisma/client";
import { DEFAULT_MODEL_ID, findModelSpec, MODEL_SPECS, parseModelId } from "@/lib/models";
import { getDynamicServerModelCatalog, hasConfiguredServerKey, resolveServerModelId } from "@/lib/server-models";
import { ApiError } from "@/lib/http";
import { prisma } from "@/lib/db/prisma";
import { assertThreadAccess } from "@/lib/threads";
import { decryptApiKeyWithMetadata, encryptApiKey, maskApiKey } from "@/lib/user-api-keys";
import { logUserApiKeyAuditEvent } from "@/lib/byok-audit";
import type { RunChatTurnInput } from "./index";

export interface PreparedChatRequest {
  thread: {
    id: string;
    title: string;
    visibility: string;
    createdByUserId: string;
    participants: { userId: string }[];
  };
  userMessage: {
    id: string;
    content: string;
    createdAt: Date;
  };
  modelId: string;
  modelSpec: ReturnType<typeof findModelSpec>;
  parsedModel: NonNullable<ReturnType<typeof parseModelId>>;
  apiKeyOverride: string | undefined;
  usingPersonalApiKey: boolean;
  selectedUserApiKeyId: string | null;
  selectedUserApiKeyProvider: ApiKeyProvider | null;
  userApiKeyUseAuditLogged: boolean;
  requestId: string;
  topK: number;
  temperature: number;
  maxOutputTokens: number;
}

export async function prepareChatRequest(input: RunChatTurnInput): Promise<PreparedChatRequest> {
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

  return {
    thread,
    userMessage,
    modelId,
    modelSpec,
    parsedModel,
    apiKeyOverride,
    usingPersonalApiKey,
    selectedUserApiKeyId,
    selectedUserApiKeyProvider,
    userApiKeyUseAuditLogged,
    requestId,
    topK,
    temperature,
    maxOutputTokens,
  };
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
