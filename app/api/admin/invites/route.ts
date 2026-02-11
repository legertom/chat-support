import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { jsonError } from "@/lib/http";
import { parseJsonBody } from "@/lib/request";
import { requireAdminUser } from "@/lib/server-auth";
import { createInviteSchema } from "@/lib/validators";
import { DEFAULT_INVITE_EXPIRY_DAYS, DEFAULT_STARTING_CREDIT_CENTS, normalizeEmail } from "@/lib/config";
import { logAdminAction } from "@/lib/admin-audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAdminUser();
    await expireStaleInvites();

    const invites = await prisma.invite.findMany({
      orderBy: [{ createdAt: "desc" }],
      include: {
        invitedBy: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
        acceptedBy: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
      },
    });

    return NextResponse.json({ invites });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const admin = await requireAdminUser();
    const body = await parseJsonBody(request, createInviteSchema);

    const email = normalizeEmail(body.email);
    const expiresInDays = body.expiresInDays ?? DEFAULT_INVITE_EXPIRY_DAYS;
    const initialCreditCents = body.initialCreditCents ?? DEFAULT_STARTING_CREDIT_CENTS;
    const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);

    const existingPendingInvite = await prisma.invite.findFirst({
      where: {
        email,
        status: "pending",
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    const invite = existingPendingInvite
      ? await prisma.invite.update({
          where: {
            id: existingPendingInvite.id,
          },
          data: {
            role: body.role,
            initialCreditCents,
            invitedByUserId: admin.id,
            expiresAt,
            status: "pending",
            acceptedByUserId: null,
            acceptedAt: null,
          },
        })
      : await prisma.invite.create({
          data: {
            email,
            role: body.role,
            initialCreditCents,
            invitedByUserId: admin.id,
            expiresAt,
          },
        });

    await logAdminAction({
      actorUserId: admin.id,
      action: "admin.invite.create",
      targetType: "invite",
      targetId: invite.id,
      metadata: {
        email,
        role: invite.role,
        initialCreditCents,
        expiresAt: invite.expiresAt.toISOString(),
        reusedPendingInvite: Boolean(existingPendingInvite),
      },
    });

    return NextResponse.json({ invite }, { status: existingPendingInvite ? 200 : 201 });
  } catch (error) {
    return jsonError(error);
  }
}

async function expireStaleInvites() {
  await prisma.invite.updateMany({
    where: {
      status: "pending",
      expiresAt: {
        lte: new Date(),
      },
    },
    data: {
      status: "expired",
    },
  });
}
