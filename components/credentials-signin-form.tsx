"use client";

import { signIn } from "next-auth/react";
import { FormEvent, useState, useTransition } from "react";

function resolveSignInErrorCode(result: { error?: string | null; url?: string | null } | null): string | null {
  const direct = result?.error?.trim() || null;

  const redirectUrl = result?.url?.trim();
  if (!redirectUrl) {
    return direct;
  }

  try {
    const parsed = new URL(redirectUrl, window.location.origin);
    const queryError = parsed.searchParams.get("error")?.trim();
    if (queryError && (!direct || direct.toLowerCase() === "accessdenied")) {
      return queryError;
    }
    return direct ?? queryError ?? null;
  } catch {
    return direct;
  }
}

function toSignInErrorMessage(code: string | null): string {
  if (!code) {
    return "Sign in failed. Check credentials and server configuration.";
  }

  const normalized = code.toLowerCase();
  if (normalized === "credentialssignin") {
    return "Credentials sign-in failed. Verify BASIC_AUTH_USERNAME and BASIC_AUTH_PASSWORD in Vercel, then retry.";
  }
  if (normalized === "configuration") {
    return "Authentication configuration is incomplete in this environment.";
  }
  if (normalized === "missing_email") {
    return "The account did not provide an email address.";
  }
  if (normalized === "disabled_user") {
    return "This account is disabled. Contact an admin.";
  }
  if (normalized === "invite_required") {
    return "This email is not allowed yet. Request an invite from an admin.";
  }
  if (normalized === "accessdenied") {
    return "Sign in was denied by server policy. Check /api/auth/callback/credentials logs in Vercel for the exact reason.";
  }
  return `Sign in failed (${code}). Check /api/auth/callback/credentials logs in Vercel.`;
}

export function CredentialsSignInForm({ callbackUrl }: { callbackUrl: string }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const normalizedUsername = username.trim();
    if (!normalizedUsername || !password) {
      setError("Username and password are required.");
      setErrorCode(null);
      return;
    }

    setError(null);
    setErrorCode(null);
    startTransition(async () => {
      try {
        const result = await signIn("credentials", {
          username: normalizedUsername,
          password,
          callbackUrl,
          redirect: false,
        });

        if (!result || result.error) {
          const code = resolveSignInErrorCode(result);
          setError(toSignInErrorMessage(code));
          setErrorCode(code);
          return;
        }

        window.location.assign(result.url ?? callbackUrl);
      } catch {
        setError("Unable to sign in right now.");
        setErrorCode(null);
      }
    });
  }

  return (
    <form className="auth-credentials-form" onSubmit={handleSubmit}>
      <p className="auth-method-title">Use username and password</p>
      <label className="auth-field">
        <span>Username</span>
        <input
          autoComplete="username"
          name="username"
          type="text"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          disabled={isPending}
        />
      </label>
      <label className="auth-field">
        <span>Password</span>
        <input
          autoComplete="current-password"
          name="password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={isPending}
        />
      </label>
      {error ? <p className="auth-inline-error">{error}</p> : null}
      {errorCode ? (
        <p className="auth-muted">
          Error code: <code>{errorCode}</code>
        </p>
      ) : null}
      <button type="submit" className="primary-button" disabled={isPending}>
        {isPending ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}
