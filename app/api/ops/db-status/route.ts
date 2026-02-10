import { prisma } from "@/lib/prisma";
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

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const source = process.env.PRISMA_DATABASE_SOURCE ?? null;
  const host = process.env.PRISMA_DATABASE_HOST ?? null;

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
