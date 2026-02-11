import { PrismaClient } from "@prisma/client";
import { assertUserApiKeyEncryptionConfigured } from "@/lib/user-api-keys";
import {
  selectDatabaseUrl,
  normalizeDatabaseUrl,
  getDatabaseHost,
  getDatabaseHostname,
  buildAppUrlWithFallbackCredentials,
} from "./connection-resolver";
import { buildNeonAdapterOptions } from "./neon-adapter";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const rawAppDatabaseUrl = process.env.APP_DATABASE_URL;
const rawDatabaseUrlUnpooled = process.env.DATABASE_URL_UNPOOLED;
const rawPostgresUrlNonPooling = process.env.POSTGRES_URL_NON_POOLING;
const rawDatabaseUrl = process.env.DATABASE_URL;
const rawPostgresPrismaUrl = process.env.POSTGRES_PRISMA_URL;
const rawPostgresUrl = process.env.POSTGRES_URL;
const rawAppDatabaseUrlWithFallbackCredentials = buildAppUrlWithFallbackCredentials(rawAppDatabaseUrl);

const resolvedDatabaseUrl = selectDatabaseUrl([
  { name: "APP_DATABASE_URL", value: rawAppDatabaseUrl },
  { name: "APP_DATABASE_URL_PLUS_FALLBACK_CREDS", value: rawAppDatabaseUrlWithFallbackCredentials },
  { name: "POSTGRES_PRISMA_URL", value: rawPostgresPrismaUrl },
  { name: "DATABASE_URL", value: rawDatabaseUrl },
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

if (selectedDatabaseUrl) {
  const neonAdapterOptions = buildNeonAdapterOptions(selectedDatabaseUrl);
  if (neonAdapterOptions) {
    prismaClientOptions = {
      ...prismaClientOptions,
      ...neonAdapterOptions,
    };
    console.info("[db] prisma neon adapter enabled", {
      host: selectedDatabaseHost,
    });
  }
}

export const prisma = globalForPrisma.prisma ?? new PrismaClient(prismaClientOptions);

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
