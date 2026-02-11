import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { ApiError, jsonError } from "@/lib/http";
import { parseJsonBody } from "@/lib/request";
import { requireAdminUser } from "@/lib/server-auth";
import { byokMigrationSchema } from "@/lib/validators";
import { decryptApiKeyWithMetadata, encryptApiKey, maskApiKey } from "@/lib/user-api-keys";
import { getRequestCorrelationId } from "@/lib/request-id";
import { logAdminAction } from "@/lib/admin-audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const admin = await requireAdminUser();
    const requestId = getRequestCorrelationId(request);

    let body: {
      dryRun?: boolean;
      limit?: number;
      userId?: string;
    } = {};

    try {
      body = await parseJsonBody(request, byokMigrationSchema);
    } catch (error) {
      if (!(error instanceof ApiError) || error.code !== "invalid_json") {
        throw error;
      }
      body = {};
    }

    const dryRun = body.dryRun ?? true;
    const limit = body.limit ?? 250;

    const items = await prisma.userApiKey.findMany({
      where: body.userId
        ? {
            userId: body.userId,
          }
        : undefined,
      orderBy: {
        updatedAt: "asc",
      },
      take: limit,
      select: {
        id: true,
        userId: true,
        provider: true,
        encryptedKey: true,
      },
    });

    let needsReencrypt = 0;
    let updated = 0;
    let failed = 0;
    const failures: Array<{ id: string; code: string }> = [];

    for (const item of items) {
      try {
        const decrypted = decryptApiKeyWithMetadata(item.encryptedKey);
        if (!decrypted.shouldReencrypt) {
          continue;
        }

        needsReencrypt += 1;
        if (dryRun) {
          continue;
        }

        await prisma.userApiKey.update({
          where: {
            id: item.id,
          },
          data: {
            encryptedKey: encryptApiKey(decrypted.apiKey),
            keyPreview: maskApiKey(decrypted.apiKey),
          },
        });
        updated += 1;
      } catch (error) {
        failed += 1;
        if (failures.length < 20) {
          failures.push({
            id: item.id,
            code: toReasonCode(error),
          });
        }
      }
    }

    await logAdminAction({
      actorUserId: admin.id,
      action: "admin.byok.migrate",
      targetType: "user_api_key",
      targetId: body.userId ?? "all",
      metadata: {
        requestId,
        dryRun,
        limit,
        scanned: items.length,
        needsReencrypt,
        updated,
        failed,
      },
    });

    return NextResponse.json({
      requestId,
      dryRun,
      limit,
      scanned: items.length,
      needsReencrypt,
      updated,
      failed,
      failures,
    });
  } catch (error) {
    return jsonError(error);
  }
}

function toReasonCode(error: unknown): string {
  if (error instanceof ApiError && error.code) {
    return error.code;
  }

  if (error instanceof Error && "code" in error && typeof (error as { code?: unknown }).code === "string") {
    return (error as { code: string }).code;
  }

  return "unexpected_error";
}

