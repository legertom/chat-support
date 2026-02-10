const DEV_FALLBACK_AUTH_SECRET = "chat-support-dev-auth-secret";
const BASIC_AUTH_USERNAME_ENV_NAMES = ["BASIC_AUTH_USERNAME", "BASIC_AUTH_USER", "AUTH_BASIC_USERNAME", "SUPPORT_USER"] as const;
const BASIC_AUTH_PASSWORD_ENV_NAMES = ["BASIC_AUTH_PASSWORD", "BASIC_AUTH_PASS", "AUTH_BASIC_PASSWORD", "SUPPORT_PASS"] as const;
const BASIC_AUTH_EMAIL_ENV_NAMES = ["BASIC_AUTH_EMAIL", "AUTH_BASIC_EMAIL"] as const;

function hasNonEmptyEnv(name: string): boolean {
  const raw = process.env[name];
  return typeof raw === "string" && raw.trim().length > 0;
}

function firstNonEmptyEnv(names: readonly string[]): string | undefined {
  for (const name of names) {
    const raw = process.env[name];
    if (typeof raw === "string") {
      const trimmed = raw.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
  }
  return undefined;
}

export function getAuthSecret(): string | undefined {
  if (hasNonEmptyEnv("AUTH_SECRET")) {
    return process.env.AUTH_SECRET!.trim();
  }

  if (process.env.NODE_ENV !== "production") {
    return DEV_FALLBACK_AUTH_SECRET;
  }

  return undefined;
}

export function hasGoogleOAuthConfig(): boolean {
  return hasNonEmptyEnv("AUTH_GOOGLE_ID") && hasNonEmptyEnv("AUTH_GOOGLE_SECRET");
}

export function getBasicAuthUsername(): string | undefined {
  return firstNonEmptyEnv(BASIC_AUTH_USERNAME_ENV_NAMES);
}

export function getBasicAuthPassword(): string | undefined {
  return firstNonEmptyEnv(BASIC_AUTH_PASSWORD_ENV_NAMES);
}

export function hasBasicAuthConfig(): boolean {
  return Boolean(getBasicAuthUsername() && getBasicAuthPassword());
}

export function getBasicAuthEmail(resolvedUsername?: string): string {
  const explicit = firstNonEmptyEnv(BASIC_AUTH_EMAIL_ENV_NAMES);
  if (explicit) {
    return explicit.toLowerCase();
  }

  const candidate = (resolvedUsername ?? getBasicAuthUsername() ?? "local-admin").trim().toLowerCase();
  if (candidate.includes("@")) {
    return candidate;
  }

  const sanitized = candidate.replace(/[^a-z0-9._-]/g, "-");
  return `${sanitized}@clever.com`;
}

export function getBasicAuthRole(): "admin" | "member" {
  const raw = process.env.BASIC_AUTH_ROLE?.trim().toLowerCase();
  return raw === "admin" ? "admin" : "member";
}

export function getMissingGoogleOAuthEnvVars(): string[] {
  const missing: string[] = [];
  if (!hasNonEmptyEnv("AUTH_GOOGLE_ID")) {
    missing.push("AUTH_GOOGLE_ID");
  }
  if (!hasNonEmptyEnv("AUTH_GOOGLE_SECRET")) {
    missing.push("AUTH_GOOGLE_SECRET");
  }
  return missing;
}

export function getMissingBasicAuthEnvVars(): string[] {
  const missing: string[] = [];
  if (!getBasicAuthUsername()) {
    missing.push("BASIC_AUTH_USERNAME");
  }
  if (!getBasicAuthPassword()) {
    missing.push("BASIC_AUTH_PASSWORD");
  }
  return missing;
}

export function getMissingSignInEnvVars(): string[] {
  const missing: string[] = [];

  if (!hasNonEmptyEnv("DATABASE_URL")) {
    missing.push("DATABASE_URL");
  }

  if (!hasGoogleOAuthConfig() && !hasBasicAuthConfig()) {
    missing.push(...getMissingBasicAuthEnvVars());
  }

  if (!getAuthSecret()) {
    missing.push("AUTH_SECRET");
  }

  return missing;
}
