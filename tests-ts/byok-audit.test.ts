import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  adminAuditCreate: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    adminAuditLog: {
      create: mocks.adminAuditCreate,
    },
  },
}));

import { logUserApiKeyAuditEvent } from "@/lib/byok-audit";

describe("BYOK audit logging", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.adminAuditCreate.mockResolvedValue({ id: "audit-1" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emits structured audit events with required fields", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    await logUserApiKeyAuditEvent({
      actorUserId: "user-1",
      action: "user_api_key.create",
      targetId: "key-123",
      provider: "openai",
      result: "success",
      requestId: "req-123",
    });

    expect(infoSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(infoSpy.mock.calls[0][0] as string) as Record<string, unknown>;
    expect(payload.type).toBe("user_api_key_audit");
    expect(payload.actorUserId).toBe("user-1");
    expect(payload.action).toBe("user_api_key.create");
    expect(payload.targetId).toBe("key-123");
    expect(payload.provider).toBe("openai");
    expect(payload.result).toBe("success");
    expect(payload.requestId).toBe("req-123");
    expect(typeof payload.timestamp).toBe("string");

    expect(mocks.adminAuditCreate).toHaveBeenCalledTimes(1);
  });

  it("redacts suspicious fields to avoid leaking secrets in logs", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    await logUserApiKeyAuditEvent({
      actorUserId: "user-2",
      action: "user_api_key.use",
      targetId: "sk-live-secret-target",
      provider: "gemini",
      result: "failure",
      requestId: "Bearer secret",
      reasonCode: "sk-live-should-be-redacted",
    });

    const payload = JSON.parse(infoSpy.mock.calls[0][0] as string) as Record<string, unknown>;
    expect(payload.targetId).toBe("redacted");
    expect(payload.requestId).toBeNull();
    expect(payload.reasonCode).toBe("redacted_reason");
    expect(JSON.stringify(payload)).not.toContain("sk-live-should-be-redacted");
    expect(JSON.stringify(payload)).not.toContain("Bearer secret");
  });
});

