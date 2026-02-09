import { NextRequest, NextResponse } from "next/server";

function unauthorizedResponse(): NextResponse {
  return new NextResponse("Authentication required.", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Secure Area", charset="UTF-8"',
    },
  });
}

export function middleware(request: NextRequest): NextResponse {
  const username = process.env.BASIC_AUTH_USERNAME ?? "";
  const password = process.env.BASIC_AUTH_PASSWORD ?? "";
  const authEnabled = username.length > 0 || password.length > 0;

  if (!authEnabled) {
    return NextResponse.next();
  }

  if (!username || !password) {
    return new NextResponse("Basic auth is misconfigured. Set both BASIC_AUTH_USERNAME and BASIC_AUTH_PASSWORD.", {
      status: 500,
    });
  }

  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Basic ")) {
    return unauthorizedResponse();
  }

  const encodedCredentials = authHeader.slice("Basic ".length).trim();
  let decodedCredentials = "";

  try {
    decodedCredentials = atob(encodedCredentials);
  } catch {
    return unauthorizedResponse();
  }

  const separatorIndex = decodedCredentials.indexOf(":");
  if (separatorIndex < 0) {
    return unauthorizedResponse();
  }

  const providedUsername = decodedCredentials.slice(0, separatorIndex);
  const providedPassword = decodedCredentials.slice(separatorIndex + 1);

  if (providedUsername !== username || providedPassword !== password) {
    return unauthorizedResponse();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)"],
};
