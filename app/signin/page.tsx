import Link from "next/link";
import { CredentialsSignInForm } from "@/components/credentials-signin-form";
import {
  getMissingBasicAuthEnvVars,
  getMissingGoogleOAuthEnvVars,
  hasBasicAuthConfig,
  hasGoogleOAuthConfig,
} from "@/lib/auth-env";

export const dynamic = "force-dynamic";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{
    callbackUrl?: string;
  }>;
}) {
  const resolvedParams = await searchParams;

  const callbackUrl =
    typeof resolvedParams.callbackUrl === "string" && resolvedParams.callbackUrl.length > 0
      ? resolvedParams.callbackUrl
      : "/";

  const googleSignInHref = `/api/auth/signin/google?callbackUrl=${encodeURIComponent(callbackUrl)}`;
  const hasGoogle = hasGoogleOAuthConfig();
  const hasBasic = hasBasicAuthConfig();
  const missingGoogleVars = getMissingGoogleOAuthEnvVars();
  const missingBasicVars = getMissingBasicAuthEnvVars();
  const hasAnyMethod = hasGoogle || hasBasic;

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <p className="auth-overline">Clever Support Chat</p>
        <h1>Sign in</h1>
        <p>Use Google SSO or local credentials. You can enable either method from <code>.env</code>.</p>

        {hasGoogle ? (
          <a href={googleSignInHref} className="primary-button">
            Continue with Google
          </a>
        ) : null}

        {hasGoogle && hasBasic ? <p className="auth-divider">or</p> : null}

        {hasBasic ? <CredentialsSignInForm callbackUrl={callbackUrl} /> : null}

        {!hasAnyMethod ? (
          <div className="auth-warning" role="alert">
            <p>No sign-in method is configured yet.</p>
            <p className="auth-muted">
              For Google: <code>{missingGoogleVars.join(", ")}</code>
            </p>
            <p className="auth-muted">
              For username/password: <code>{missingBasicVars.join(", ")}</code>
            </p>
          </div>
        ) : null}

        <p className="auth-muted">
          Need access? Ask an admin for an invite, or return to <Link href="/">home</Link>.
        </p>
      </section>
    </main>
  );
}
