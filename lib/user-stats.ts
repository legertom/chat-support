import { prisma } from "@/lib/db/prisma";

export interface UserProfileResponse {
  user: {
    id: string;
    email: string;
    name: string | null;
    image: string | null;
    role: "admin" | "member";
    status: "active" | "disabled";
    createdAt: string;
    lastActiveAt: string | null;
  };
  wallet: {
    balanceCents: number;
    lifetimeGrantedCents: number;
    lifetimeSpentCents: number;
    debitedCents: number;
  };
  usage: {
    billedTurnCount: number;
    lifetimeInputTokens: number;
    lifetimeOutputTokens: number;
    lifetimeTotalTokens: number;
  };
}

export async function getUserProfile(userId: string): Promise<UserProfileResponse> {
  const [user, wallet, recentSpend, billedMessages] = await Promise.all([
    prisma.user.findUnique({
      where: {
        id: userId,
      },
    }),
    prisma.wallet.findUnique({
      where: {
        userId,
      },
    }),
    prisma.walletLedger.aggregate({
      where: {
        userId,
        type: "debit",
      },
      _sum: {
        amountCents: true,
      },
    }),
    prisma.walletLedger.findMany({
      where: {
        userId,
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

  if (!user) {
    throw new Error("User not found");
  }

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

  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      image: user.image,
      role: user.role,
      status: user.status,
      createdAt: user.createdAt.toISOString(),
      lastActiveAt: user.lastActiveAt?.toISOString() ?? null,
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
  };
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
