import { NextResponse } from "next/server";
import { Prisma, type ApiKeyProvider } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { jsonError, ApiError } from "@/lib/http";
import { parseJsonBody } from "@/lib/request";
import { requireDbUser } from "@/lib/server-auth";
import { updateUserApiKeySchema } from "@/lib/validators";
import { encryptApiKey, maskApiKey } from "@/lib/user-api-keys";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getRequestCorrelationId } from "@/lib/request-id";
import { logUserApiKeyAuditEvent } from "@/lib/byok-audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = getRequestCorrelationId(request);
  let actorUserId: string | null = null;
  let providerForAudit: ApiKeyProvider | null = null;
  let targetId = "unknown";

  try {
    const user = await requireDbUser();
    actorUserId = user.id;
    enforceRateLimit({
      scope: "user_api_key:update",
      key: user.id,
      limit: 20,
      windowMs: 60_000,
    });

    const { id } = await context.params;
    const keyId = id.trim();
    targetId = keyId || "unknown";

    if (!keyId) {
      throw new ApiError(400, "Key id is required.", "missing_api_key_id");
    }

    const body = await parseJsonBody(request, updateUserApiKeySchema);

    const existing = await prisma.userApiKey.findFirst({
      where: {
        id: keyId,
        userId: user.id,
      },
      select: {
        id: true,
        provider: true,
      },
    });

    if (!existing) {
      throw new ApiError(404, "Saved key not found.", "api_key_not_found");
    }

    if (body.provider && body.provider !== existing.provider && !body.apiKey) {
      throw new ApiError(
        400,
        "Changing provider requires replacing the API key.",
        "api_key_required_for_provider_change"
      );
    }
    providerForAudit = body.provider ?? existing.provider;

    const updated = await prisma.userApiKey.update({
      where: {
        id: existing.id,
      },
      data: {
        provider: body.provider,
        label: body.label,
        encryptedKey: body.apiKey ? encryptApiKey(body.apiKey) : undefined,
        keyPreview: body.apiKey ? maskApiKey(body.apiKey) : undefined,
      },
      select: {
        id: true,
        provider: true,
        label: true,
        keyPreview: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    await logUserApiKeyAuditEvent({
      actorUserId: user.id,
      action: "user_api_key.update",
      targetId: updated.id,
      provider: updated.provider,
      result: "success",
      requestId,
    });

    return NextResponse.json({ key: updated });
  } catch (error) {
    if (actorUserId) {
      await logUserApiKeyAuditEvent({
        actorUserId,
        action: "user_api_key.update",
        targetId,
        provider: providerForAudit,
        result: "failure",
        requestId,
        reasonCode: toAuditReasonCode(error),
      });
    }

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002" &&
      Array.isArray((error.meta as { target?: unknown } | undefined)?.target) &&
      (error.meta as { target: string[] }).target.includes("label")
    ) {
      return NextResponse.json(
        {
          error: "A key with that label already exists in your profile.",
          code: "duplicate_api_key_label",
        },
        { status: 400 }
      );
    }

    return jsonError(error);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = getRequestCorrelationId(request);
  let actorUserId: string | null = null;
  let targetId = "unknown";
  let providerForAudit: ApiKeyProvider | null = null;

  try {
    const user = await requireDbUser();
    actorUserId = user.id;
    enforceRateLimit({
      scope: "user_api_key:delete",
      key: user.id,
      limit: 12,
      windowMs: 60_000,
    });

    const { id } = await context.params;
    const keyId = id.trim();
    targetId = keyId || "unknown";

    if (!keyId) {
      throw new ApiError(400, "Key id is required.", "missing_api_key_id");
    }

    const existing = await prisma.userApiKey.findFirst({
      where: {
        id: keyId,
        userId: user.id,
      },
      select: {
        id: true,
        provider: true,
      },
    });
    providerForAudit = existing?.provider ?? null;
    if (!existing) {
      throw new ApiError(404, "Saved key not found.", "api_key_not_found");
    }

    const deleted = await prisma.userApiKey.deleteMany({
      where: {
        id: existing.id,
        userId: user.id,
      },
    });

    if (deleted.count === 0) {
      throw new ApiError(404, "Saved key not found.", "api_key_not_found");
    }

    await logUserApiKeyAuditEvent({
      actorUserId: user.id,
      action: "user_api_key.delete",
      targetId: existing.id,
      provider: existing.provider,
      result: "success",
      requestId,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (actorUserId) {
      await logUserApiKeyAuditEvent({
        actorUserId,
        action: "user_api_key.delete",
        targetId,
        provider: providerForAudit,
        result: "failure",
        requestId,
        reasonCode: toAuditReasonCode(error),
      });
    }

    return jsonError(error);
  }
}

function toAuditReasonCode(error: unknown): string {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code;
  }

  if (error instanceof Error && "code" in error && typeof (error as { code?: unknown }).code === "string") {
    return (error as { code: string }).code;
  }

  return "unexpected_error";
}
