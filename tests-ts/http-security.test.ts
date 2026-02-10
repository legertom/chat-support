import { describe, expect, it } from "vitest";
import { ApiError, jsonError } from "@/lib/http";

describe("jsonError security", () => {
  it("sanitizes unexpected errors and avoids leaking raw internals", async () => {
    const response = jsonError(new Error("Upstream failure sk-live-should-not-leak"));
    const payload = (await response.json()) as { error?: string; code?: string };

    expect(response.status).toBe(500);
    expect(payload.error).toBe("Unexpected server error.");
    expect(payload.code).toBe("internal_server_error");
    expect(JSON.stringify(payload)).not.toContain("sk-live-should-not-leak");
  });

  it("preserves explicit ApiError responses", async () => {
    const response = jsonError(new ApiError(400, "Invalid body", "invalid_body"));
    const payload = (await response.json()) as { error?: string; code?: string };

    expect(response.status).toBe(400);
    expect(payload).toEqual({
      error: "Invalid body",
      code: "invalid_body",
    });
  });
});

