import { prisma } from "@/lib/db/prisma";
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

function getDatabaseCredentialMetadata(value: string): {
  usernamePresent: boolean;
  passwordPresent: boolean;
  databasePresent: boolean;
} {
  try {
    const parsed = new URL(value);
    return {
      usernamePresent: parsed.username.length > 0,
      passwordPresent: parsed.password.length > 0,
      databasePresent: parsed.pathname.replace(/^\//, "").length > 0,
    };
  } catch {
    return {
      usernamePresent: false,
      passwordPresent: false,
      databasePresent: false,
    };
  }
}

function discoverPostgresUrlEnvCandidates(): Array<{ source: string; value: string }> {
  const discovered: Array<{ source: string; value: string }> = [];

  for (const [name, rawValue] of Object.entries(process.env)) {
    if (typeof rawValue !== "string") {
      continue;
    }

    const value = rawValue.trim();
    if (!(value.startsWith("postgres://") || value.startsWith("postgresql://"))) {
      continue;
    }

    discovered.push({
      source: `ENV:${name}`,
      value,
    });
  }

  return discovered;
}

function buildUrlFromPgComponents(): string | null {
  const host = process.env.PGHOST?.trim() || process.env.POSTGRES_HOST?.trim();
  const user = process.env.PGUSER?.trim() || process.env.POSTGRES_USER?.trim();
  const password = process.env.PGPASSWORD?.trim() || process.env.POSTGRES_PASSWORD?.trim();
  const database = process.env.PGDATABASE?.trim() || process.env.POSTGRES_DATABASE?.trim();

  if (!host || !user || !password || !database) {
    return null;
  }

  const url = new URL(`postgresql://${host}/${database}`);
  url.username = user;
  url.password = password;
  url.searchParams.set("sslmode", "require");
  if (host.includes("-pooler.")) {
    url.searchParams.set("connect_timeout", "15");
  }
  return url.toString();
}

function buildAppUrlWithPassword(): string | null {
  const appUrl = process.env.APP_DATABASE_URL?.trim();
  const fallbackPassword = process.env.PGPASSWORD?.trim() || process.env.POSTGRES_PASSWORD?.trim();

  if (!appUrl || !fallbackPassword) {
    return null;
  }

  try {
    const parsed = new URL(appUrl);
    if (parsed.password) {
      return null;
    }
    parsed.password = fallbackPassword;
    if (!parsed.searchParams.get("sslmode")) {
      parsed.searchParams.set("sslmode", "require");
    }
    if (parsed.hostname.includes("-pooler.") && !parsed.searchParams.get("connect_timeout")) {
      parsed.searchParams.set("connect_timeout", "15");
    }
    return parsed.toString();
  } catch {
    return null;
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
    { source: "APP_DATABASE_URL_PLUS_PGPASSWORD", value: buildAppUrlWithPassword() },
    { source: "COMPOSED_PG_COMPONENTS_URL", value: buildUrlFromPgComponents() },
    ...discoverPostgresUrlEnvCandidates(),
  ]
    .map((candidate) => ({ ...candidate, value: candidate.value?.trim() ?? "" }))
    .filter((candidate) => candidate.value.length > 0);

  const seen = new Set<string>();
  const results: Array<{
    source: string;
    host: string;
    usernamePresent: boolean;
    passwordPresent: boolean;
    databasePresent: boolean;
    ok: boolean;
    error?: { name: string; message: string; code: string | null };
  }> = [];

  for (const candidate of candidates) {
    if (seen.has(candidate.value)) {
      continue;
    }
    seen.add(candidate.value);

    const metadata = getDatabaseCredentialMetadata(candidate.value);

    try {
      const sql = neon(candidate.value);
      await sql`SELECT 1`;
      results.push({
        source: candidate.source,
        host: getDatabaseHost(candidate.value),
        ...metadata,
        ok: true,
      });
    } catch (error) {
      results.push({
        source: candidate.source,
        host: getDatabaseHost(candidate.value),
        ...metadata,
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
