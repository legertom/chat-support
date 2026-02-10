import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import { assertUserApiKeyEncryptionConfigured } from "@/lib/user-api-keys";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
type EnvCandidate = { name: string; value: string | undefined };

function nonEmptyEnvValues(candidates: ReadonlyArray<EnvCandidate>): Array<{ source: string; value: string }> {
  const resolved: Array<{ source: string; value: string }> = [];

  for (const candidate of candidates) {
    if (typeof candidate.value !== "string") {
      continue;
    }
    const trimmed = candidate.value.trim();
    if (trimmed.length > 0) {
      resolved.push({ source: candidate.name, value: trimmed });
    }
  }

  return resolved;
}

function getDatabaseHost(value: string): string {
  try {
    return new URL(value).host;
  } catch {
    return "invalid-url";
  }
}

function getDatabaseHostname(value: string): string {
  try {
    return new URL(value).hostname;
  } catch {
    return "invalid-url";
  }
}

function isNeonHostname(hostname: string): boolean {
  return hostname.endsWith(".aws.neon.tech");
}

function isPoolerHostname(hostname: string): boolean {
  return hostname.includes("-pooler.");
}

function selectDatabaseUrl(candidates: ReadonlyArray<EnvCandidate>): { source: string; value: string } | null {
  const allNonEmpty = nonEmptyEnvValues(candidates);
  const first = allNonEmpty[0] ?? null;
  if (!first) {
    return null;
  }

  const firstHostname = getDatabaseHostname(first.value);
  if (!isNeonHostname(firstHostname) || isPoolerHostname(firstHostname)) {
    return first;
  }

  const poolerCandidate = allNonEmpty.find((candidate) => {
    const hostname = getDatabaseHostname(candidate.value);
    return isNeonHostname(hostname) && isPoolerHostname(hostname);
  });

  if (poolerCandidate) {
    return {
      source: `${poolerCandidate.source} (auto-selected Neon pooler host over ${first.source})`,
      value: poolerCandidate.value,
    };
  }

  return first;
}

function normalizeDatabaseUrl(value: string): { value: string; adjustments: string[] } {
  const adjustments: string[] = [];

  try {
    const parsed = new URL(value);
    const isNeonHost = isNeonHostname(parsed.hostname);

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

const resolvedDatabaseUrl = selectDatabaseUrl([
  // Prefer URLs explicitly intended for Prisma/serverless runtime first.
  { name: "POSTGRES_PRISMA_URL", value: rawPostgresPrismaUrl },
  { name: "DATABASE_URL", value: rawDatabaseUrl },
  { name: "APP_DATABASE_URL", value: rawAppDatabaseUrl },
  { name: "POSTGRES_URL", value: rawPostgresUrl },
  { name: "DATABASE_URL_UNPOOLED", value: rawDatabaseUrlUnpooled },
  { name: "POSTGRES_URL_NON_POOLING", value: rawPostgresUrlNonPooling },
]);

let selectedDatabaseUrl: string | null = null;
let selectedDatabaseHost = "invalid-url";

if (resolvedDatabaseUrl) {
  const normalizedDatabaseUrl = normalizeDatabaseUrl(resolvedDatabaseUrl.value);
  process.env.DATABASE_URL = normalizedDatabaseUrl.value;
  selectedDatabaseUrl = normalizedDatabaseUrl.value;
  selectedDatabaseHost = getDatabaseHost(normalizedDatabaseUrl.value);
  process.env.PRISMA_DATABASE_SOURCE = resolvedDatabaseUrl.source;
  process.env.PRISMA_DATABASE_HOST = selectedDatabaseHost;
  console.info("[db] prisma datasource url selected", {
    source: resolvedDatabaseUrl.source,
    host: selectedDatabaseHost,
    adjustments: normalizedDatabaseUrl.adjustments,
  });
} else {
  console.error("[db] no database url configured for prisma datasource");
}

assertUserApiKeyEncryptionConfigured();

const prismaLogLevel = (process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"]) as Array<
  "query" | "info" | "warn" | "error"
>;
let prismaClientOptions: ConstructorParameters<typeof PrismaClient>[0] = {
  log: prismaLogLevel,
};

if (selectedDatabaseUrl && isNeonHostname(getDatabaseHostname(selectedDatabaseUrl))) {
  if (typeof WebSocket === "undefined") {
    neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
  }

  prismaClientOptions = {
    ...prismaClientOptions,
    adapter: new PrismaNeon({ connectionString: selectedDatabaseUrl }),
  };

  console.info("[db] prisma neon adapter enabled", {
    host: selectedDatabaseHost,
  });
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient(prismaClientOptions);

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
