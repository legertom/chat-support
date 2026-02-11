import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { ApiError, jsonError } from "@/lib/http";
import { parseJsonBody } from "@/lib/request";
import { requireAdminUser } from "@/lib/server-auth";
import { updateInviteSchema } from "@/lib/validators";
import { DEFAULT_INVITE_EXPIRY_DAYS } from "@/lib/config";
import { logAdminAction } from "@/lib/admin-audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdminUser();
    const { id: inviteId } = await context.params;
    const body = await parseJsonBody(request, updateInviteSchema);

    const existingInvite = await prisma.invite.findUnique({
      where: {
        id: inviteId,
      },
    });

    if (!existingInvite) {
      throw new ApiError(404, "Invite not found", "invite_not_found");
    }

    const updatedInvite =
      body.action === "revoke"
        ? await prisma.invite.update({
            where: {
              id: inviteId,
            },
            data: {
              status: "revoked",
            },
          })
        : await prisma.invite.update({
            where: {
              id: inviteId,
            },
            data: {
              status: "pending",
              invitedByUserId: admin.id,
              expiresAt: new Date(
                Date.now() + (body.expiresInDays ?? DEFAULT_INVITE_EXPIRY_DAYS) * 24 * 60 * 60 * 1000
              ),
              acceptedByUserId: null,
              acceptedAt: null,
            },
          });

    await logAdminAction({
      actorUserId: admin.id,
      action: `admin.invite.${body.action}`,
      targetType: "invite",
      targetId: inviteId,
      metadata: {
        previousStatus: existingInvite.status,
        nextStatus: updatedInvite.status,
        expiresAt: updatedInvite.expiresAt.toISOString(),
      },
    });

    return NextResponse.json({ invite: updatedInvite });
  } catch (error) {
    return jsonError(error);
  }
}
