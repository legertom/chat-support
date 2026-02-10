const FALLBACK_STARTING_CREDIT_CENTS = 200;
const FALLBACK_INVITE_EXPIRY_DAYS = 14;

function toInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }

  return parsed;
}

function parseEmailList(raw: string | undefined): Set<string> {
  if (!raw) {
    return new Set();
  }

  return new Set(
    raw
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter((item) => item.length > 0)
  );
}

export const DEFAULT_STARTING_CREDIT_CENTS = toInt(
  process.env.DEFAULT_STARTING_CREDIT_CENTS,
  FALLBACK_STARTING_CREDIT_CENTS
);

export const DEFAULT_INVITE_EXPIRY_DAYS = toInt(process.env.DEFAULT_INVITE_EXPIRY_DAYS, FALLBACK_INVITE_EXPIRY_DAYS);

export const INITIAL_ADMIN_EMAILS = parseEmailList(process.env.INITIAL_ADMIN_EMAILS);

export const APP_NAME = "Clever Support Chat";

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isCleverEmail(email: string): boolean {
  return normalizeEmail(email).endsWith("@clever.com");
}
