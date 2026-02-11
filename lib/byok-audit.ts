import type { ApiKeyProvider } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";

type UserApiKeyAuditAction = "user_api_key.create" | "user_api_key.update" | "user_api_key.delete" | "user_api_key.use";
type UserApiKeyAuditResult = "success" | "failure";
const SAFE_TOKEN_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const SAFE_REASON_CODE_PATTERN = /^[a-z0-9_.:-]{1,80}$/;
const SENSITIVE_FRAGMENT_PATTERN = /(sk-[a-z0-9]|apikey|api[-_]?key|bearer|token|AIza)/i;

interface UserApiKeyAuditEvent {
  actorUserId: string;
  action: UserApiKeyAuditAction;
  targetId: string;
  provider: ApiKeyProvider | null;
  result: UserApiKeyAuditResult;
  requestId: string | null;
  reasonCode?: string | null;
}

export async function logUserApiKeyAuditEvent(input: UserApiKeyAuditEvent): Promise<void> {
  const timestamp = new Date().toISOString();
  const normalizedTargetId = sanitizeToken(input.targetId, "redacted");
  const normalizedRequestId = sanitizeToken(input.requestId, null);
  const normalizedReasonCode = normalizeReasonCode(input.reasonCode);
  const payload = {
    actorUserId: input.actorUserId,
    action: input.action,
    targetId: normalizedTargetId,
    provider: input.provider,
    result: input.result,
    requestId: normalizedRequestId,
    reasonCode: normalizedReasonCode,
    timestamp,
  };

  // Structured log for centralized log pipelines.
  console.info(JSON.stringify({ type: "user_api_key_audit", ...payload }));

  try {
    await prisma.adminAuditLog.create({
      data: {
        actorUserId: input.actorUserId,
        action: input.action,
        targetType: "user_api_key",
        targetId: input.targetId,
        metadata: payload,
      },
    });
  } catch {
    // Never fail user-facing requests when audit storage is unavailable.
  }
}

function sanitizeToken(value: string | null | undefined, fallback: string | null): string | null {
  if (!value) {
    return fallback;
  }

  const trimmed = value.trim();
  if (!SAFE_TOKEN_PATTERN.test(trimmed) || SENSITIVE_FRAGMENT_PATTERN.test(trimmed)) {
    return fallback;
  }

  return trimmed;
}

function normalizeReasonCode(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim().toLowerCase();
  if (!SAFE_REASON_CODE_PATTERN.test(trimmed) || SENSITIVE_FRAGMENT_PATTERN.test(trimmed)) {
    return "redacted_reason";
  }

  return trimmed;
}
