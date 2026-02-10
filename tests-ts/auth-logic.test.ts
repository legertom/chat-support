import { describe, expect, it } from "vitest";
import { evaluateLoginAccess } from "@/lib/auth-logic";

describe("evaluateLoginAccess", () => {
  it("allows verified clever.com user", () => {
    const result = evaluateLoginAccess({
      email: "engineer@clever.com",
      emailVerified: true,
      invite: null,
      userStatus: "active",
    });

    expect(result).toEqual({ allowed: true });
  });

  it("allows invited external verified user", () => {
    const result = evaluateLoginAccess({
      email: "external@gmail.com",
      emailVerified: true,
      userStatus: "active",
      now: new Date("2026-02-09T00:00:00.000Z"),
      invite: {
        email: "external@gmail.com",
        role: "member",
        initialCreditCents: 200,
        status: "pending",
        expiresAt: new Date("2026-03-01T00:00:00.000Z"),
      },
    });

    expect(result).toEqual({ allowed: true });
  });

  it("denies unverified user", () => {
    const result = evaluateLoginAccess({
      email: "engineer@clever.com",
      emailVerified: false,
      invite: null,
      userStatus: "active",
    });

    expect(result).toEqual({
      allowed: false,
      reason: "unverified_email",
    });
  });

  it("denies external user without active invite", () => {
    const result = evaluateLoginAccess({
      email: "someone@gmail.com",
      emailVerified: true,
      userStatus: undefined,
      invite: null,
    });

    expect(result).toEqual({
      allowed: false,
      reason: "invite_required",
    });
  });

  it("allows previously provisioned invited external user without a current invite", () => {
    const result = evaluateLoginAccess({
      email: "returning.external@gmail.com",
      emailVerified: true,
      userStatus: "active",
      invite: null,
    });

    expect(result).toEqual({ allowed: true });
  });
});
