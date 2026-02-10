import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/http";

const mocks = vi.hoisted(() => ({
  requireDbUser: vi.fn(),
  parseJsonBody: vi.fn(),
  findFirst: vi.fn(),
  update: vi.fn(),
  logUserApiKeyAuditEvent: vi.fn(),
  enforceRateLimit: vi.fn(),
}));

vi.mock("@/lib/server-auth", () => ({
  requireDbUser: mocks.requireDbUser,
}));

vi.mock("@/lib/request", () => ({
  parseJsonBody: mocks.parseJsonBody,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    userApiKey: {
      findFirst: mocks.findFirst,
      update: mocks.update,
      deleteMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/user-api-keys", () => ({
  encryptApiKey: (value: string) => `enc:${value}`,
  maskApiKey: (value: string) => `mask:${value}`,
}));

vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: mocks.enforceRateLimit,
}));

vi.mock("@/lib/request-id", () => ({
  getRequestCorrelationId: () => "req-test",
}));

vi.mock("@/lib/byok-audit", () => ({
  logUserApiKeyAuditEvent: mocks.logUserApiKeyAuditEvent,
}));

import { PATCH } from "@/app/api/me/keys/[id]/route";

describe("PATCH /api/me/keys/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireDbUser.mockResolvedValue({ id: "user-1" });
    mocks.enforceRateLimit.mockReturnValue(undefined);
    mocks.logUserApiKeyAuditEvent.mockResolvedValue(undefined);
  });

  it("enforces ownership check by querying key with current user id", async () => {
    mocks.parseJsonBody.mockResolvedValue({ label: "Renamed key" });
    mocks.findFirst.mockResolvedValue(null);

    const response = await PATCH(new Request("http://localhost/api/me/keys/key-2"), {
      params: Promise.resolve({ id: "key-2" }),
    });
    const payload = (await response.json()) as { code?: string };

    expect(response.status).toBe(404);
    expect(payload.code).toBe("api_key_not_found");
    expect(mocks.findFirst).toHaveBeenCalledWith({
      where: {
        id: "key-2",
        userId: "user-1",
      },
      select: {
        id: true,
        provider: true,
      },
    });
  });

  it("blocks provider changes unless a replacement apiKey is supplied", async () => {
    mocks.parseJsonBody.mockResolvedValue({ provider: "anthropic" });
    mocks.findFirst.mockResolvedValue({ id: "key-1", provider: "openai" });

    const response = await PATCH(new Request("http://localhost/api/me/keys/key-1"), {
      params: Promise.resolve({ id: "key-1" }),
    });
    const payload = (await response.json()) as { code?: string; error?: string };

    expect(response.status).toBe(400);
    expect(payload.code).toBe("api_key_required_for_provider_change");
    expect(payload.error).toMatch(/Changing provider requires replacing the API key/i);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("returns 429 when rate limit is exceeded", async () => {
    mocks.enforceRateLimit.mockImplementation(() => {
      throw new ApiError(429, "Too many requests. Try again shortly.", "rate_limited");
    });

    const response = await PATCH(new Request("http://localhost/api/me/keys/key-1"), {
      params: Promise.resolve({ id: "key-1" }),
    });
    const payload = (await response.json()) as { code?: string };

    expect(response.status).toBe(429);
    expect(payload.code).toBe("rate_limited");
  });
});

