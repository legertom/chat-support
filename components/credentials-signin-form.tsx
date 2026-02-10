"use client";

import { signIn } from "next-auth/react";
import { FormEvent, useState, useTransition } from "react";

export function CredentialsSignInForm({ callbackUrl }: { callbackUrl: string }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const normalizedUsername = username.trim();
    if (!normalizedUsername || !password) {
      setError("Username and password are required.");
      return;
    }

    setError(null);
    startTransition(async () => {
      try {
        const result = await signIn("credentials", {
          username: normalizedUsername,
          password,
          callbackUrl,
          redirect: false,
        });

        if (!result || result.error) {
          setError("Invalid username or password.");
          return;
        }

        window.location.assign(result.url ?? callbackUrl);
      } catch {
        setError("Unable to sign in right now.");
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
      <button type="submit" className="primary-button" disabled={isPending}>
        {isPending ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}

