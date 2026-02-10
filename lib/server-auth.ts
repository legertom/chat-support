import type { Prisma, User } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/http";
import { normalizeEmail } from "@/lib/config";

export async function requireSessionUser(): Promise<{ id: string; email: string }> {
  const session = await auth();
  const email = session?.user?.email;

  if (!session?.user || typeof email !== "string") {
    throw new ApiError(401, "Unauthorized", "unauthorized");
  }

  const userId = session.user.id;
  if (typeof userId !== "string" || userId.length === 0) {
    throw new ApiError(401, "Unauthorized", "unauthorized");
  }

  return {
    id: userId,
    email: normalizeEmail(email),
  };
}

export async function requireDbUser<TInclude extends Prisma.UserInclude | undefined = undefined>(options?: {
  include?: TInclude;
}) {
  const sessionUser = await requireSessionUser();

  const user = await prisma.user.findUnique({
    where: {
      id: sessionUser.id,
    },
    include: options?.include,
  });

  if (!user) {
    throw new ApiError(401, "Unauthorized", "unauthorized");
  }

  if (user.status !== "active") {
    throw new ApiError(403, "Account is disabled", "account_disabled");
  }

  return user;
}

export async function requireAdminUser<TInclude extends Prisma.UserInclude | undefined = undefined>(options?: {
  include?: TInclude;
}) {
  const user = await requireDbUser(options);
  if (user.role !== "admin") {
    throw new ApiError(403, "Admin access required", "forbidden");
  }
  return user;
}

export function assertCanAccessThread(user: Pick<User, "id">, thread: {
  visibility: "org" | "private";
  createdByUserId: string;
  participants?: Array<{ userId: string }>;
}): void {
  if (thread.visibility === "org") {
    return;
  }

  if (thread.createdByUserId === user.id) {
    return;
  }

  if (Array.isArray(thread.participants) && thread.participants.some((participant) => participant.userId === user.id)) {
    return;
  }

  throw new ApiError(403, "Forbidden", "forbidden");
}
