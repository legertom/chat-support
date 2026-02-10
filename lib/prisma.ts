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

function normalizeDatabaseUrl(value: string): { value: string; adjustments: string[] } {
  const adjustments: string[] = [];

  try {
    const parsed = new URL(value);
    const isNeonHost = parsed.hostname.endsWith(".aws.neon.tech");

    if (isNeonHost) {
      if (!parsed.searchParams.get("sslmode")) {
        parsed.searchParams.set("sslmode", "require");
        adjustments.push("sslmode=require");
      }

      if (!parsed.searchParams.get("connect_timeout")) {
        parsed.searchParams.set("connect_timeout", "15");
        adjustments.push("connect_timeout=15");
      }
    }

    return {
      value: parsed.toString(),
      adjustments,
    };
  } catch {
    return { value, adjustments };
  }
}

const rawAppDatabaseUrl = process.env.APP_DATABASE_URL;
const rawDatabaseUrlUnpooled = process.env.DATABASE_URL_UNPOOLED;
const rawPostgresUrlNonPooling = process.env.POSTGRES_URL_NON_POOLING;
const rawDatabaseUrl = process.env.DATABASE_URL;
const rawPostgresPrismaUrl = process.env.POSTGRES_PRISMA_URL;
const rawPostgresUrl = process.env.POSTGRES_URL;

const appDatabaseUrl = firstNonEmptyEnvValue([{ name: "APP_DATABASE_URL", value: rawAppDatabaseUrl }]);
const unpooledCandidate = firstNonEmptyEnvValue([
  { name: "DATABASE_URL_UNPOOLED", value: rawDatabaseUrlUnpooled },
  { name: "POSTGRES_URL_NON_POOLING", value: rawPostgresUrlNonPooling },
]);

const resolvedDatabaseUrl =
  appDatabaseUrl && getDatabaseHost(appDatabaseUrl.value).includes("-pooler.") && unpooledCandidate
    ? {
        source: `${unpooledCandidate.source} (auto-selected over APP_DATABASE_URL pooler host)`,
        value: unpooledCandidate.value,
      }
    : firstNonEmptyEnvValue([
        { name: "APP_DATABASE_URL", value: rawAppDatabaseUrl },
        { name: "DATABASE_URL_UNPOOLED", value: rawDatabaseUrlUnpooled },
        { name: "POSTGRES_URL_NON_POOLING", value: rawPostgresUrlNonPooling },
        { name: "DATABASE_URL", value: rawDatabaseUrl },
        { name: "POSTGRES_PRISMA_URL", value: rawPostgresPrismaUrl },
        { name: "POSTGRES_URL", value: rawPostgresUrl },
      ]);

if (resolvedDatabaseUrl) {
  const normalizedDatabaseUrl = normalizeDatabaseUrl(resolvedDatabaseUrl.value);
  process.env.DATABASE_URL = normalizedDatabaseUrl.value;
  console.info("[db] prisma datasource url selected", {
    source: resolvedDatabaseUrl.source,
    host: getDatabaseHost(normalizedDatabaseUrl.value),
    adjustments: normalizedDatabaseUrl.adjustments,
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
