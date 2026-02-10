import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/http";

const mocks = vi.hoisted(() => {
  const tx = {
    wallet: {
      updateMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
    },
    walletLedger: {
      create: vi.fn(),
    },
  };

  return {
    tx,
    prisma: {
      $transaction: vi.fn(async (callback: (txArg: typeof tx) => Promise<unknown>) => callback(tx)),
    },
  };
});

vi.mock("@/lib/prisma", () => ({
  prisma: mocks.prisma,
}));

import { finalizeReservedSpend, reserveBudget } from "@/lib/wallet";

describe("wallet reservation and settlement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reserves budget when balance is sufficient", async () => {
    mocks.tx.wallet.updateMany.mockResolvedValue({ count: 1 });
    mocks.tx.wallet.findUnique.mockResolvedValue({ balanceCents: 150 });

    const result = await reserveBudget({
      userId: "user-1",
      amountCents: 50,
      requestId: "req-1",
      threadId: "thread-1",
      modelId: "openai:gpt-5-mini",
      provider: "openai",
    });

    expect(result.remainingBalanceCents).toBe(150);
    expect(mocks.tx.wallet.updateMany).toHaveBeenCalledTimes(1);
    expect(mocks.tx.walletLedger.create).toHaveBeenCalledTimes(1);
  });

  it("throws insufficient balance when reserve fails", async () => {
    mocks.tx.wallet.updateMany.mockResolvedValue({ count: 0 });
    mocks.tx.wallet.findUnique.mockResolvedValue({ balanceCents: 20 });

    const reservationPromise = reserveBudget({
      userId: "user-1",
      amountCents: 50,
      requestId: "req-2",
    });

    await expect(reservationPromise).rejects.toBeInstanceOf(ApiError);
    await expect(reservationPromise).rejects.toMatchObject({ status: 402 });
    expect(mocks.tx.walletLedger.create).not.toHaveBeenCalled();
  });

  it("finalizes debit and releases unused reservation", async () => {
    mocks.tx.wallet.update.mockResolvedValue({
      balanceCents: 88,
      lifetimeSpentCents: 12,
    });

    const result = await finalizeReservedSpend({
      userId: "user-1",
      reservedCents: 20,
      actualCostCents: 12,
      requestId: "req-4",
      threadId: "thread-1",
      messageId: "message-1",
      modelId: "openai:gpt-5-mini",
      provider: "openai",
    });

    expect(result.debitedCents).toBe(12);
    expect(result.releasedCents).toBe(8);
    expect(result.remainingBalanceCents).toBe(88);
    expect(mocks.tx.walletLedger.create).toHaveBeenCalledTimes(2);
  });
});
