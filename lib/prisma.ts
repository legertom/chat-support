import { PrismaClient } from "@prisma/client";
import { assertUserApiKeyEncryptionConfigured } from "@/lib/user-api-keys";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function firstNonEmptyEnvValue(
  candidates: ReadonlyArray<{
    name: string;
    value: string | undefined;
  }>
): { source: string; value: string } | null {
  for (const candidate of candidates) {
    if (typeof candidate.value !== "string") {
      continue;
    }
    const trimmed = candidate.value.trim();
    if (trimmed.length > 0) {
      return { source: candidate.name, value: trimmed };
    }
  }
  return null;
}

function getDatabaseHost(value: string): string {
  try {
    return new URL(value).host;
  } catch {
    return "invalid-url";
  }
}

const resolvedDatabaseUrl = firstNonEmptyEnvValue([
  { name: "APP_DATABASE_URL", value: process.env.APP_DATABASE_URL },
  { name: "DATABASE_URL_UNPOOLED", value: process.env.DATABASE_URL_UNPOOLED },
  { name: "POSTGRES_URL_NON_POOLING", value: process.env.POSTGRES_URL_NON_POOLING },
  { name: "DATABASE_URL", value: process.env.DATABASE_URL },
  { name: "POSTGRES_PRISMA_URL", value: process.env.POSTGRES_PRISMA_URL },
  { name: "POSTGRES_URL", value: process.env.POSTGRES_URL },
]);

if (resolvedDatabaseUrl) {
  process.env.DATABASE_URL = resolvedDatabaseUrl.value;
  console.info("[db] prisma datasource url selected", {
    source: resolvedDatabaseUrl.source,
    host: getDatabaseHost(resolvedDatabaseUrl.value),
  });
} else {
  console.error("[db] no database url configured for prisma datasource");
}

assertUserApiKeyEncryptionConfigured();

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
