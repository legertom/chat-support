import { NextResponse } from "next/server";
import { Prisma, type ApiKeyProvider } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { jsonError } from "@/lib/http";
import { parseJsonBody } from "@/lib/request";
import { requireDbUser } from "@/lib/server-auth";
import { createUserApiKeySchema } from "@/lib/validators";
import { encryptApiKey, maskApiKey } from "@/lib/user-api-keys";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getRequestCorrelationId } from "@/lib/request-id";
import { logApiKeySuccess, logApiKeyFailure } from "@/lib/api-key-route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireDbUser();
    const keys = await prisma.userApiKey.findMany({
      where: {
        userId: user.id,
      },
      orderBy: {
        createdAt: "desc",
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

    return NextResponse.json({
      items: keys,
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  const requestId = getRequestCorrelationId(request);
  let actorUserId: string | null = null;
  let providerForAudit: ApiKeyProvider | null = null;

  try {
    const user = await requireDbUser();
    actorUserId = user.id;
    enforceRateLimit({
      scope: "user_api_key:create",
      key: user.id,
      limit: 12,
      windowMs: 60_000,
    });

    const body = await parseJsonBody(request, createUserApiKeySchema);
    providerForAudit = body.provider;

    const created = await prisma.userApiKey.create({
      data: {
        userId: user.id,
        provider: body.provider,
        label: body.label,
        keyPreview: maskApiKey(body.apiKey),
        encryptedKey: encryptApiKey(body.apiKey),
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

    await logApiKeySuccess({
      userId: user.id,
      action: "user_api_key.create",
      keyId: created.id,
      provider: created.provider,
      requestId,
    });

    return NextResponse.json({ key: created }, { status: 201 });
  } catch (error) {
    if (actorUserId) {
      await logApiKeyFailure({
        userId: actorUserId,
        action: "user_api_key.create",
        keyId: "unknown",
        provider: providerForAudit,
        requestId,
        error,
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
