import { describe, expect, it, vi, beforeEach } from "vitest";
import { ApiError } from "@/lib/http";

const mocks = vi.hoisted(() => ({
  requireAdminUser: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock("@/lib/server-auth", () => ({
  requireAdminUser: mocks.requireAdminUser,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findMany: mocks.findMany,
    },
  },
}));

import { GET } from "@/app/api/admin/users/route";

describe("admin RBAC", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 403 when non-admin requests admin users endpoint", async () => {
    mocks.requireAdminUser.mockRejectedValue(new ApiError(403, "Admin access required", "forbidden"));

    const response = await GET();
    expect(response.status).toBe(403);
  });

  it("returns users when admin is authorized", async () => {
    mocks.requireAdminUser.mockResolvedValue({ id: "admin-1" });
    mocks.findMany.mockResolvedValue([
      {
        id: "user-1",
        email: "user@example.com",
        name: "Member",
        role: "member",
        status: "active",
        createdAt: new Date("2026-02-09T00:00:00.000Z"),
        lastActiveAt: null,
        wallet: {
          balanceCents: 200,
          lifetimeGrantedCents: 200,
          lifetimeSpentCents: 0,
        },
      },
    ]);

    const response = await GET();
    expect(response.status).toBe(200);

    const payload = (await response.json()) as {
      totals: {
        userCount: number;
      };
      users: Array<{ email: string }>;
    };

    expect(payload.totals.userCount).toBe(1);
    expect(payload.users[0].email).toBe("user@example.com");
  });
});
