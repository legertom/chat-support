import { PrismaClient } from "@prisma/client";
import { assertUserApiKeyEncryptionConfigured } from "@/lib/user-api-keys";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

assertUserApiKeyEncryptionConfigured();

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
