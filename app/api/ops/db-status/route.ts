import { prisma } from "@/lib/prisma";
import { neon } from "@neondatabase/serverless";
import { getBasicAuthPassword, getBasicAuthUsername } from "@/lib/auth-env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getRequestCredentials(request: Request): { username: string; password: string } | null {
  const authorization = request.headers.get("authorization");
  if (!authorization || !authorization.startsWith("Basic ")) {
    return null;
  }

  try {
    const encoded = authorization.slice("Basic ".length).trim();
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    const separatorIndex = decoded.indexOf(":");
    if (separatorIndex <= 0) {
      return null;
    }
    return {
      username: decoded.slice(0, separatorIndex),
      password: decoded.slice(separatorIndex + 1),
    };
  } catch {
    return null;
  }
}

function isAuthorized(request: Request): boolean {
  const expectedUsername = getBasicAuthUsername();
  const expectedPassword = getBasicAuthPassword();

  if (!expectedUsername || !expectedPassword) {
    return false;
  }

  const credentials = getRequestCredentials(request);
  if (!credentials) {
    return false;
  }

  return credentials.username === expectedUsername && credentials.password === expectedPassword;
}

function toErrorContext(error: unknown): { name: string; message: string; code: string | null } {
  if (error instanceof Error) {
    const withCode = error as Error & { code?: string };
    return {
      name: error.name,
      message: error.message,
      code: typeof withCode.code === "string" ? withCode.code : null,
    };
  }
  return {
    name: "UnknownError",
    message: String(error),
    code: null,
  };
}

function getDatabaseHost(value: string): string {
  try {
    return new URL(value).host;
  } catch {
    return "invalid-url";
  }
}

async function scanCandidateUrls() {
  const candidates = [
    { source: "APP_DATABASE_URL", value: process.env.APP_DATABASE_URL },
    { source: "POSTGRES_PRISMA_URL", value: process.env.POSTGRES_PRISMA_URL },
    { source: "DATABASE_URL", value: process.env.DATABASE_URL },
    { source: "POSTGRES_URL", value: process.env.POSTGRES_URL },
    { source: "DATABASE_URL_UNPOOLED", value: process.env.DATABASE_URL_UNPOOLED },
    { source: "POSTGRES_URL_NON_POOLING", value: process.env.POSTGRES_URL_NON_POOLING },
    { source: "POSTGRES_URL_NO_SSL", value: process.env.POSTGRES_URL_NO_SSL },
  ]
    .map((candidate) => ({ ...candidate, value: candidate.value?.trim() ?? "" }))
    .filter((candidate) => candidate.value.length > 0);

  const seen = new Set<string>();
  const results: Array<{
    source: string;
    host: string;
    ok: boolean;
    error?: { name: string; message: string; code: string | null };
  }> = [];

  for (const candidate of candidates) {
    if (seen.has(candidate.value)) {
      continue;
    }
    seen.add(candidate.value);

    try {
      const sql = neon(candidate.value);
      await sql`SELECT 1`;
      results.push({
        source: candidate.source,
        host: getDatabaseHost(candidate.value),
        ok: true,
      });
    } catch (error) {
      results.push({
        source: candidate.source,
        host: getDatabaseHost(candidate.value),
        ok: false,
        error: toErrorContext(error),
      });
    }
  }

  return results;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const mode = new URL(request.url).searchParams.get("mode");

  const source = process.env.PRISMA_DATABASE_SOURCE ?? null;
  const host = process.env.PRISMA_DATABASE_HOST ?? null;

  if (mode === "scan") {
    const scanResults = await scanCandidateUrls();
    return Response.json({
      ok: scanResults.some((result) => result.ok),
      selectedSource: source,
      selectedHost: host,
      scanResults,
    });
  }

  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({
      ok: true,
      source,
      host,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        source,
        host,
        error: toErrorContext(error),
      },
      { status: 503 }
    );
  }
}
