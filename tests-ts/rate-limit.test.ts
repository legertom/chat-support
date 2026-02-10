import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/http";
import { __resetRateLimitBucketsForTests, enforceRateLimit } from "@/lib/rate-limit";

describe("rate limiting", () => {
  it("throws ApiError when the limit is exceeded", () => {
    __resetRateLimitBucketsForTests();

    expect(() =>
      enforceRateLimit({
        scope: "test",
        key: "user-1",
        limit: 2,
        windowMs: 60_000,
      })
    ).not.toThrow();

    expect(() =>
      enforceRateLimit({
        scope: "test",
        key: "user-1",
        limit: 2,
        windowMs: 60_000,
      })
    ).not.toThrow();

    expect(() =>
      enforceRateLimit({
        scope: "test",
        key: "user-1",
        limit: 2,
        windowMs: 60_000,
      })
    ).toThrowError(ApiError);
  });
});

