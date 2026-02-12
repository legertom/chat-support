"use client";

import { signIn } from "next-auth/react";
import { useState, useTransition } from "react";

export function GoogleSignInButton({ callbackUrl }: { callbackUrl: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    startTransition(async () => {
      try {
        await signIn("google", { callbackUrl });
      } catch {
        setError("Unable to start Google sign-in.");
      }
    });
  }

  return (
    <>
      <button
        type="button"
        className="primary-button"
        onClick={handleClick}
        disabled={isPending}
      >
        {isPending ? "Redirecting..." : "Continue with Google"}
      </button>
      {error ? <p className="auth-inline-error">{error}</p> : null}
    </>
  );
}
