import type { Invite, UserRole, UserStatus } from "@prisma/client";
import { INITIAL_ADMIN_EMAILS, isCleverEmail, normalizeEmail } from "@/lib/config";

export type AuthDenyReason = "missing_email" | "unverified_email" | "disabled_user" | "invite_required";

export interface AccessEvaluation {
  allowed: boolean;
  reason?: AuthDenyReason;
}

export interface InviteLike {
  email: string;
  role: UserRole;
  initialCreditCents: number;
  status: "pending" | "accepted" | "revoked" | "expired";
  expiresAt: Date;
}

export function evaluateLoginAccess(input: {
  email: string | null | undefined;
  emailVerified: boolean;
  userStatus?: UserStatus | null;
  invite?: InviteLike | null;
  now?: Date;
}): AccessEvaluation {
  const now = input.now ?? new Date();
  const email = normalizeMaybeEmail(input.email);

  if (!email) {
    return { allowed: false, reason: "missing_email" };
  }

  if (!input.emailVerified) {
    return { allowed: false, reason: "unverified_email" };
  }

  if (input.userStatus === "disabled") {
    return { allowed: false, reason: "disabled_user" };
  }

  if (isCleverEmail(email)) {
    return { allowed: true };
  }

  if (input.userStatus === "active") {
    // Previously provisioned invited users remain allowed after invite acceptance.
    return { allowed: true };
  }

  const invite = input.invite;
  if (invite && invite.status === "pending" && invite.expiresAt.getTime() > now.getTime()) {
    return { allowed: true };
  }

  return { allowed: false, reason: "invite_required" };
}

export function resolveInitialRole(email: string, invite: Pick<Invite, "role"> | null): UserRole {
  if (invite) {
    return invite.role;
  }

  if (INITIAL_ADMIN_EMAILS.has(normalizeEmail(email))) {
    return "admin";
  }

  return "member";
}

export function normalizeMaybeEmail(email: string | null | undefined): string | null {
  if (typeof email !== "string") {
    return null;
  }

  const normalized = normalizeEmail(email);
  return normalized.length > 0 ? normalized : null;
}

export function authErrorToMessage(reason: AuthDenyReason): string {
  switch (reason) {
    case "missing_email":
      return "Google did not return an email address for this account.";
    case "unverified_email":
      return "Only verified Google accounts can sign in.";
    case "disabled_user":
      return "Your account is currently disabled. Contact an admin.";
    case "invite_required":
      return "This email is not permitted yet. Request an invite from a Clever admin.";
    default:
      return "Sign-in was denied.";
  }
}
