import type { Prisma } from "@prisma/client";
import { calculateCost, findModelSpec, type ModelSpec } from "@/lib/models";
import { estimateTokens } from "@/lib/tokens";
import { prisma } from "@/lib/db/prisma";
import { ApiError } from "@/lib/http";

const RESERVATION_SAFETY_MULTIPLIER = 1.25;

export interface CostEstimate {
  inputTokensEstimate: number;
  outputTokensEstimate: number;
  estimatedCostCents: number;
  pricingTier: "standard" | "long-context" | "unknown";
}

export function usdToCentsCeil(usd: number): number {
  if (!Number.isFinite(usd) || usd <= 0) {
    return 0;
  }
  return Math.ceil(usd * 100);
}

export function estimateMaxTurnCostCents(input: {
  modelId: string;
  modelSpec?: ModelSpec;
  systemPrompt: string;
  messages: Array<{ content: string }>;
  maxOutputTokens: number;
}): CostEstimate {
  const modelSpec = input.modelSpec ?? findModelSpec(input.modelId);
  const promptText = [input.systemPrompt, ...input.messages.map((message) => message.content)].join("\n");
  const inputTokensEstimate = Math.max(1, estimateTokens(promptText));
  const outputTokensEstimate = Math.max(1, Math.round(input.maxOutputTokens));

  const estimatedCost = calculateCost(
    {
      inputTokens: inputTokensEstimate,
      outputTokens: outputTokensEstimate,
      totalTokens: inputTokensEstimate + outputTokensEstimate,
    },
    input.modelId,
    modelSpec
  );

  if (!estimatedCost.hasPricing) {
    throw new ApiError(400, "Selected model pricing is unavailable for budget enforcement.", "pricing_unavailable");
  }

  const estimatedCostCents = Math.max(1, Math.ceil(estimatedCost.totalCostUsd * 100 * RESERVATION_SAFETY_MULTIPLIER));

  return {
    inputTokensEstimate,
    outputTokensEstimate,
    estimatedCostCents,
    pricingTier: estimatedCost.pricingTier,
  };
}

export async function reserveBudget(input: {
  userId: string;
  amountCents: number;
  requestId: string;
  threadId?: string;
  modelId?: string;
  provider?: string;
  metadata?: Prisma.InputJsonValue;
}) {
  if (input.amountCents <= 0) {
    throw new ApiError(400, "Reservation amount must be positive.", "invalid_reservation");
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.wallet.updateMany({
      where: {
        userId: input.userId,
        balanceCents: {
          gte: input.amountCents,
        },
      },
      data: {
        balanceCents: {
          decrement: input.amountCents,
        },
      },
    });

    if (updated.count === 0) {
      const wallet = await tx.wallet.findUnique({
        where: {
          userId: input.userId,
        },
        select: {
          balanceCents: true,
        },
      });

      throw new ApiError(
        402,
        "Insufficient balance for this request.",
        `insufficient_balance:${wallet?.balanceCents ?? 0}`
      );
    }

    await tx.walletLedger.create({
      data: {
        userId: input.userId,
        type: "reservation",
        amountCents: input.amountCents,
        currency: "USD",
        threadId: input.threadId,
        requestId: input.requestId,
        modelId: input.modelId,
        provider: input.provider,
        metadata: input.metadata,
      },
    });

    const wallet = await tx.wallet.findUnique({
      where: {
        userId: input.userId,
      },
      select: {
        balanceCents: true,
      },
    });

    return {
      remainingBalanceCents: wallet?.balanceCents ?? 0,
    };
  });
}

export async function releaseReservation(input: {
  userId: string;
  reservedCents: number;
  requestId: string;
  threadId?: string;
  messageId?: string;
  modelId?: string;
  provider?: string;
  metadata?: Prisma.InputJsonValue;
}) {
  if (input.reservedCents <= 0) {
    return { remainingBalanceCents: 0 };
  }

  return prisma.$transaction(async (tx) => {
    const wallet = await tx.wallet.update({
      where: {
        userId: input.userId,
      },
      data: {
        balanceCents: {
          increment: input.reservedCents,
        },
      },
      select: {
        balanceCents: true,
      },
    });

    await tx.walletLedger.create({
      data: {
        userId: input.userId,
        type: "release",
        amountCents: input.reservedCents,
        currency: "USD",
        threadId: input.threadId,
        messageId: input.messageId,
        requestId: input.requestId,
        modelId: input.modelId,
        provider: input.provider,
        metadata: input.metadata,
      },
    });

    return {
      remainingBalanceCents: wallet.balanceCents,
    };
  });
}

export async function finalizeReservedSpend(input: {
  userId: string;
  reservedCents: number;
  actualCostCents: number;
  requestId: string;
  threadId?: string;
  messageId?: string;
  modelId?: string;
  provider?: string;
  metadata?: Prisma.InputJsonValue;
}) {
  const reservedCents = Math.max(0, Math.round(input.reservedCents));
  const rawActual = Math.max(0, Math.round(input.actualCostCents));
  const debitedCents = Math.min(rawActual, reservedCents);
  const releasedCents = Math.max(0, reservedCents - debitedCents);

  return prisma.$transaction(async (tx) => {
    const wallet = await tx.wallet.update({
      where: {
        userId: input.userId,
      },
      data: {
        lifetimeSpentCents: {
          increment: debitedCents,
        },
        balanceCents: releasedCents > 0 ? { increment: releasedCents } : undefined,
      },
      select: {
        balanceCents: true,
        lifetimeSpentCents: true,
      },
    });

    if (debitedCents > 0) {
      await tx.walletLedger.create({
        data: {
          userId: input.userId,
          type: "debit",
          amountCents: debitedCents,
          currency: "USD",
          threadId: input.threadId,
          messageId: input.messageId,
          requestId: input.requestId,
          modelId: input.modelId,
          provider: input.provider,
          metadata: {
            ...(asObject(input.metadata) ?? {}),
            rawActualCostCents: rawActual,
            debitedCents,
          },
        },
      });
    }

    if (releasedCents > 0) {
      await tx.walletLedger.create({
        data: {
          userId: input.userId,
          type: "release",
          amountCents: releasedCents,
          currency: "USD",
          threadId: input.threadId,
          messageId: input.messageId,
          requestId: input.requestId,
          modelId: input.modelId,
          provider: input.provider,
          metadata: {
            ...(asObject(input.metadata) ?? {}),
            rawActualCostCents: rawActual,
            debitedCents,
          },
        },
      });
    }

    return {
      debitedCents,
      releasedCents,
      remainingBalanceCents: wallet.balanceCents,
    };
  });
}

export async function grantCredit(input: {
  userId: string;
  amountCents: number;
  actorUserId: string;
  reason?: string | null;
}) {
  if (input.amountCents <= 0) {
    throw new ApiError(400, "Credit amount must be positive.", "invalid_credit_amount");
  }

  return prisma.$transaction(async (tx) => {
    const wallet = await tx.wallet.upsert({
      where: {
        userId: input.userId,
      },
      create: {
        userId: input.userId,
        balanceCents: input.amountCents,
        lifetimeGrantedCents: input.amountCents,
        lifetimeSpentCents: 0,
      },
      update: {
        balanceCents: {
          increment: input.amountCents,
        },
        lifetimeGrantedCents: {
          increment: input.amountCents,
        },
      },
      select: {
        balanceCents: true,
      },
    });

    await tx.walletLedger.create({
      data: {
        userId: input.userId,
        type: "grant",
        amountCents: input.amountCents,
        currency: "USD",
        metadata: {
          reason: input.reason ?? null,
          grantedByUserId: input.actorUserId,
        },
      },
    });

    return {
      remainingBalanceCents: wallet.balanceCents,
    };
  });
}

function asObject(value: Prisma.InputJsonValue | undefined): Record<string, unknown> | null {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    return null;
  }

  return value as Record<string, unknown>;
}
