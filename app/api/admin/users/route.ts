import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { jsonError } from "@/lib/http";
import { requireAdminUser } from "@/lib/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAdminUser();

    const users = await prisma.user.findMany({
      orderBy: [{ createdAt: "desc" }],
      include: {
        wallet: true,
      },
    });

    const totals = users.reduce(
      (acc, user) => {
        acc.balanceCents += user.wallet?.balanceCents ?? 0;
        acc.lifetimeSpentCents += user.wallet?.lifetimeSpentCents ?? 0;
        acc.lifetimeGrantedCents += user.wallet?.lifetimeGrantedCents ?? 0;
        if (user.status === "active") {
          acc.activeUsers += 1;
        }
        return acc;
      },
      {
        userCount: users.length,
        activeUsers: 0,
        balanceCents: 0,
        lifetimeSpentCents: 0,
        lifetimeGrantedCents: 0,
      }
    );

    return NextResponse.json({
      totals,
      users: users.map((user) => ({
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        status: user.status,
        createdAt: user.createdAt,
        lastActiveAt: user.lastActiveAt,
        wallet: {
          balanceCents: user.wallet?.balanceCents ?? 0,
          lifetimeSpentCents: user.wallet?.lifetimeSpentCents ?? 0,
          lifetimeGrantedCents: user.wallet?.lifetimeGrantedCents ?? 0,
        },
      })),
    });
  } catch (error) {
    return jsonError(error);
  }
}
