import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import { getDatabaseHostname, isNeonHostname } from "./connection-resolver";

export function buildNeonAdapterOptions(databaseUrl: string): ConstructorParameters<typeof PrismaClient>[0] | null {
  if (!isNeonHostname(getDatabaseHostname(databaseUrl))) {
    return null;
  }

  if (typeof WebSocket === "undefined") {
    neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
  }

  return {
    adapter: new PrismaNeon({ connectionString: databaseUrl }),
  };
}
