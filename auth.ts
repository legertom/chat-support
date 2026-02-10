import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import type { InviteStatus, Prisma, UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { DEFAULT_STARTING_CREDIT_CENTS } from "@/lib/config";
import { evaluateLoginAccess, normalizeMaybeEmail, resolveInitialRole } from "@/lib/auth-logic";
import { getAuthSecret, getBasicAuthRole } from "@/lib/auth-env";
import authConfig from "@/auth.config";

const INVITE_PENDING_STATUS: InviteStatus = "pending";
const authSecret = getAuthSecret();

function getErrorRedirect(reason: string): string {
  return `/auth/error?error=${encodeURIComponent(reason)}`;
}

async function findActiveInvite(email: string, now: Date) {
  return prisma.invite.findFirst({
    where: {
      email,
      status: INVITE_PENDING_STATUS,
      expiresAt: {
        gt: now,
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });
}

async function provisionUserOnSignIn(input: {
  email: string;
  now: Date;
  preferredRole?: UserRole;
}): Promise<void> {
  const { email, now, preferredRole } = input;

  await prisma.$transaction(async (tx) => {
    const [existingUser, invite] = await Promise.all([
      tx.user.findUnique({
        where: { email },
        select: {
          id: true,
          role: true,
        },
      }),
      tx.invite.findFirst({
        where: {
          email,
          status: INVITE_PENDING_STATUS,
          expiresAt: { gt: now },
        },
        orderBy: {
          createdAt: "desc",
        },
      }),
    ]);

    const resolvedRole = preferredRole ?? resolveInitialRole(email, invite);
    const roleToPersist: UserRole = existingUser?.role === "admin" ? "admin" : resolvedRole;

    const userData: Prisma.UserUpdateInput = {
      email,
      role: roleToPersist,
      status: "active",
      lastActiveAt: now,
    };

    const dbUser = existingUser
      ? await tx.user.update({
          where: { id: existingUser.id },
          data: userData,
          select: {
            id: true,
          },
        })
      : await tx.user.create({
          data: {
            email,
            role: roleToPersist,
            status: "active",
            lastActiveAt: now,
          },
          select: {
            id: true,
          },
        });

    const wallet = await tx.wallet.findUnique({
      where: {
        userId: dbUser.id,
      },
    });

    if (!wallet) {
      const initialCreditCents = invite?.initialCreditCents ?? DEFAULT_STARTING_CREDIT_CENTS;

      await tx.wallet.create({
        data: {
          userId: dbUser.id,
          balanceCents: initialCreditCents,
          lifetimeGrantedCents: initialCreditCents,
          lifetimeSpentCents: 0,
        },
      });

      await tx.walletLedger.create({
        data: {
          userId: dbUser.id,
          type: "grant",
          amountCents: initialCreditCents,
          currency: "USD",
          metadata: {
            reason: invite ? "invite_initial_credit" : "default_starting_credit",
          },
        },
      });
    }

    if (invite) {
      await tx.invite.update({
        where: { id: invite.id },
        data: {
          status: "accepted",
          acceptedByUserId: dbUser.id,
          acceptedAt: now,
        },
      });
    }
  });
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma),
  callbacks: {
    async signIn({ user, profile, account }) {
      const email = normalizeMaybeEmail(user.email);
      const now = new Date();

      const existingUser = email
        ? await prisma.user.findUnique({
            where: { email },
            select: {
              status: true,
            },
          })
        : null;

      if (account?.provider === "credentials") {
        if (!email) {
          return getErrorRedirect("missing_email");
        }
        if (existingUser?.status === "disabled") {
          return getErrorRedirect("disabled_user");
        }
        return true;
      }

      const emailVerified = Boolean((profile as { email_verified?: boolean } | undefined)?.email_verified === true);
      const invite = email ? await findActiveInvite(email, now) : null;

      const access = evaluateLoginAccess({
        email,
        emailVerified,
        userStatus: existingUser?.status,
        invite,
        now,
      });

      if (!access.allowed) {
        return getErrorRedirect(access.reason ?? "invite_required");
      }

      return true;
    },
    async session({ session }) {
      const email = normalizeMaybeEmail(session.user?.email);
      if (!email || !session.user) {
        return session;
      }

      const dbUser = await prisma.user.findUnique({
        where: { email },
        include: {
          wallet: true,
        },
      });

      if (!dbUser) {
        return session;
      }

      session.user.id = dbUser.id;
      session.user.role = dbUser.role;
      session.user.status = dbUser.status;
      session.user.balanceCents = dbUser.wallet?.balanceCents ?? 0;
      return session;
    },
  },
  events: {
    async signIn({ user, account }) {
      const email = normalizeMaybeEmail(user.email);
      if (!email) {
        return;
      }

      await provisionUserOnSignIn({
        email,
        now: new Date(),
        preferredRole: account?.provider === "credentials" ? getBasicAuthRole() : undefined,
      });
    },
  },
  session: {
    strategy: "jwt",
  },
  secret: authSecret,
});
