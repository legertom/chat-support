import { ApiError } from "@/lib/http";
import { releaseReservation } from "@/lib/wallet";
import { logUserApiKeyAuditEvent } from "@/lib/byok-audit";
import { prepareChatRequest } from "./prepare-request";
import { executeChatTurn } from "./execute-turn";
import { finalizeChatResponse } from "./finalize-response";
import type { ChatTurnExecution } from "./execute-turn";

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
  const prepared = await prepareChatRequest(input);
  let execution: ChatTurnExecution | undefined;
  try {
    execution = await executeChatTurn(prepared, input.sources);
  } catch (error) {
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
        result: "failure",
        requestId: prepared.requestId,
        reasonCode: auditReasonCodeFromError(error),
      });
    }

    if (!prepared.usingPersonalApiKey && execution && execution.reservedBudgetCents > 0) {
      await releaseReservation({
        userId: prepared.thread.createdByUserId,
        reservedCents: execution.reservedBudgetCents,
        requestId: prepared.requestId,
        threadId: prepared.thread.id,
        modelId: prepared.modelId,
        provider: prepared.parsedModel.provider,
        metadata: {
          reason: "provider_error",
          code: error instanceof ApiError && error.code ? error.code : "provider_request_failed",
        },
      });
    }
    throw error;
  }
  return finalizeChatResponse(prepared, execution);
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
