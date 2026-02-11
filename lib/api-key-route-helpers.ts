import { Prisma, type ApiKeyProvider } from "@prisma/client";
import { logUserApiKeyAuditEvent } from "@/lib/byok-audit";

export async function logApiKeySuccess(params: {
  userId: string;
  action: "user_api_key.create" | "user_api_key.update" | "user_api_key.delete";
  keyId: string;
  provider: ApiKeyProvider | null;
  requestId: string;
}): Promise<void> {
  await logUserApiKeyAuditEvent({
    actorUserId: params.userId,
    action: params.action,
    targetId: params.keyId,
    provider: params.provider,
    result: "success",
    requestId: params.requestId,
  });
}

export async function logApiKeyFailure(params: {
  userId: string;
  action: "user_api_key.create" | "user_api_key.update" | "user_api_key.delete";
  keyId: string;
  provider: ApiKeyProvider | null;
  requestId: string;
  error: unknown;
}): Promise<void> {
  await logUserApiKeyAuditEvent({
    actorUserId: params.userId,
    action: params.action,
    targetId: params.keyId,
    provider: params.provider,
    result: "failure",
    requestId: params.requestId,
    reasonCode: toAuditReasonCode(params.error),
  });
}

export function toAuditReasonCode(error: unknown): string {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code;
  }

  if (error instanceof Error && "code" in error && typeof (error as { code?: unknown }).code === "string") {
    return (error as { code: string }).code;
  }

  return "unexpected_error";
}
