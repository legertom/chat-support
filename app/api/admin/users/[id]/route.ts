import { NextResponse } from "next/server";
import { ApiError, jsonError } from "@/lib/http";
import { parseJsonBody } from "@/lib/request";
import { requireAdminUser } from "@/lib/server-auth";
import { updateUserSchema } from "@/lib/validators";
import { prisma } from "@/lib/db/prisma";
import { logAdminAction } from "@/lib/admin-audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdminUser();
    const { id: userId } = await context.params;
    const body = await parseJsonBody(request, updateUserSchema);

    if (admin.id === userId && body.status === "disabled") {
      throw new ApiError(400, "You cannot disable your own account.", "self_disable_forbidden");
    }

    const updatedUser = await prisma.user.update({
      where: {
        id: userId,
      },
      data: {
        role: body.role,
        status: body.status,
      },
      include: {
        wallet: true,
      },
    });

    await logAdminAction({
      actorUserId: admin.id,
      action: "admin.user.update",
      targetType: "user",
      targetId: userId,
      metadata: {
        role: body.role ?? null,
        status: body.status ?? null,
      },
    });

    return NextResponse.json({
      user: {
        id: updatedUser.id,
        email: updatedUser.email,
        role: updatedUser.role,
        status: updatedUser.status,
        createdAt: updatedUser.createdAt,
        lastActiveAt: updatedUser.lastActiveAt,
        balanceCents: updatedUser.wallet?.balanceCents ?? 0,
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
