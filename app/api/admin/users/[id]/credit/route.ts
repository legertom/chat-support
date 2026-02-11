import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { ApiError, jsonError } from "@/lib/http";
import { parseJsonBody } from "@/lib/request";
import { requireAdminUser } from "@/lib/server-auth";
import { creditTopupSchema } from "@/lib/validators";
import { grantCredit } from "@/lib/wallet";
import { logAdminAction } from "@/lib/admin-audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdminUser();
    const { id: targetUserId } = await context.params;
    const body = await parseJsonBody(request, creditTopupSchema);

    const target = await prisma.user.findUnique({
      where: {
        id: targetUserId,
      },
      select: {
        id: true,
      },
    });

    if (!target) {
      throw new ApiError(404, "User not found", "user_not_found");
    }

    const result = await grantCredit({
      userId: targetUserId,
      amountCents: body.amountCents,
      actorUserId: admin.id,
      reason: body.reason ?? null,
    });

    await logAdminAction({
      actorUserId: admin.id,
      action: "admin.user.credit",
      targetType: "user",
      targetId: targetUserId,
      metadata: {
        amountCents: body.amountCents,
        reason: body.reason ?? null,
      },
    });

    return NextResponse.json({
      userId: targetUserId,
      amountCents: body.amountCents,
      remainingBalanceCents: result.remainingBalanceCents,
    });
  } catch (error) {
    return jsonError(error);
  }
}
