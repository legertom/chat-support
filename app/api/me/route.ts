import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { jsonError } from "@/lib/http";
import { parseJsonBody } from "@/lib/request";
import { requireDbUser } from "@/lib/server-auth";
import { updateProfileSchema } from "@/lib/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const currentUser = await requireDbUser();

    const [wallet, recentSpend, billedMessages] = await Promise.all([
      prisma.wallet.findUnique({
        where: {
          userId: currentUser.id,
        },
      }),
      prisma.walletLedger.aggregate({
        where: {
          userId: currentUser.id,
          type: "debit",
        },
        _sum: {
          amountCents: true,
        },
      }),
      prisma.walletLedger.findMany({
        where: {
          userId: currentUser.id,
          type: "debit",
          messageId: {
            not: null,
          },
        },
        select: {
          message: {
            select: {
              usage: true,
            },
          },
        },
      }),
    ]);

    let lifetimeInputTokens = 0;
    let lifetimeOutputTokens = 0;
    let lifetimeTotalTokens = 0;

    for (const entry of billedMessages) {
      const usage = asRecord(entry.message?.usage);
      if (!usage) {
        continue;
      }

      const inputTokens = coerceNumber(usage.inputTokens);
      const outputTokens = coerceNumber(usage.outputTokens);
      const totalTokens = coerceNumber(usage.totalTokens);

      if (inputTokens > 0) {
        lifetimeInputTokens += inputTokens;
      }
      if (outputTokens > 0) {
        lifetimeOutputTokens += outputTokens;
      }

      if (totalTokens > 0) {
        lifetimeTotalTokens += totalTokens;
      } else if (inputTokens > 0 || outputTokens > 0) {
        lifetimeTotalTokens += inputTokens + outputTokens;
      }
    }

    return NextResponse.json({
      user: {
        id: currentUser.id,
        email: currentUser.email,
        name: currentUser.name,
        image: currentUser.image,
        role: currentUser.role,
        status: currentUser.status,
        createdAt: currentUser.createdAt,
        lastActiveAt: currentUser.lastActiveAt,
      },
      wallet: {
        balanceCents: wallet?.balanceCents ?? 0,
        lifetimeGrantedCents: wallet?.lifetimeGrantedCents ?? 0,
        lifetimeSpentCents: wallet?.lifetimeSpentCents ?? 0,
        debitedCents: recentSpend._sum.amountCents ?? 0,
      },
      usage: {
        billedTurnCount: billedMessages.length,
        lifetimeInputTokens,
        lifetimeOutputTokens,
        lifetimeTotalTokens,
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const currentUser = await requireDbUser();
    const body = await parseJsonBody(request, updateProfileSchema);

    const updatedUser = await prisma.user.update({
      where: {
        id: currentUser.id,
      },
      data: {
        name: body.name,
      },
      select: {
        id: true,
        email: true,
        name: true,
        image: true,
        role: true,
        status: true,
        createdAt: true,
        lastActiveAt: true,
      },
    });

    return NextResponse.json({
      user: updatedUser,
    });
  } catch (error) {
    return jsonError(error);
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    return null;
  }
  return value as Record<string, unknown>;
}

function coerceNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.round(value);
  }
  return 0;
}
