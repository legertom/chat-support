import Link from "next/link";
import { authErrorToMessage } from "@/lib/auth-logic";
import { getMissingSignInEnvVars } from "@/lib/auth-env";

const KNOWN_ERRORS = new Set(["missing_email", "unverified_email", "disabled_user", "invite_required", "db_unreachable"]);

export const dynamic = "force-dynamic";

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
  }>;
}) {
  const resolvedParams = await searchParams;
  const rawError = typeof resolvedParams.error === "string" ? resolvedParams.error : "";
  const normalizedError = rawError.toLowerCase();
  const missingVars = getMissingSignInEnvVars();
  const isConfigurationError = normalizedError === "configuration";

  const message =
    isConfigurationError && missingVars.length > 0
      ? "Authentication is not configured yet for this environment."
      : normalizedError === "credentialssignin"
        ? "Invalid username or password."
      : KNOWN_ERRORS.has(normalizedError)
        ? authErrorToMessage(
            normalizedError as "missing_email" | "unverified_email" | "disabled_user" | "invite_required" | "db_unreachable"
          )
        : "Sign in was denied. If this is unexpected, contact an admin.";

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <p className="auth-overline">Authentication</p>
        <h1>Access denied</h1>
        <p>{message}</p>
        {isConfigurationError && missingVars.length > 0 ? (
          <p className="auth-muted">
            Missing env vars in <code>.env</code>: <code>{missingVars.join(", ")}</code>
          </p>
        ) : null}
        <p className="auth-muted">Error code: {rawError || "unknown"}</p>
        <div className="auth-actions">
          <Link href="/signin" className="primary-button">
            Try again
          </Link>
          <Link href="/" className="ghost-button">
            Back to app
          </Link>
        </div>
      </section>
    </main>
  );
}
