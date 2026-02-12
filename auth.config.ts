import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import {
  getAuthSecret,
  getBasicAuthEmail,
  getBasicAuthPassword,
  getBasicAuthUsername,
  hasBasicAuthConfig,
  hasGoogleOAuthConfig,
} from "@/lib/auth-env";

const secret = getAuthSecret();
const hasGoogle = hasGoogleOAuthConfig();
const hasBasicAuth = hasBasicAuthConfig();

const providers: NonNullable<NextAuthConfig["providers"]> = [];

if (hasGoogle) {
  providers.push(
    Google({
      clientId: process.env.AUTH_GOOGLE_ID!.trim(),
      clientSecret: process.env.AUTH_GOOGLE_SECRET!.trim(),
      allowDangerousEmailAccountLinking: true,
    })
  );
}

if (hasBasicAuth) {
  providers.push(
    Credentials({
      id: "credentials",
      name: "Username and password",
      credentials: {
        username: {
          label: "Username",
          type: "text",
        },
        password: {
          label: "Password",
          type: "password",
        },
      },
      authorize(credentials) {
        const usernameInput = typeof credentials?.username === "string" ? credentials.username.trim() : "";
        const passwordInput = typeof credentials?.password === "string" ? credentials.password : "";
        const configuredUsername = getBasicAuthUsername();
        const configuredPassword = getBasicAuthPassword();

        if (!configuredUsername || !configuredPassword) {
          console.error("[auth][credentials] missing basic auth env vars", {
            hasUsername: Boolean(configuredUsername),
            hasPassword: Boolean(configuredPassword),
          });
          return null;
        }

        const usernameMatches = usernameInput === configuredUsername;
        const passwordMatches = passwordInput === configuredPassword;

        if (!usernameMatches || !passwordMatches) {
          console.warn("[auth][credentials] credentials mismatch", {
            usernameMatches,
            passwordMatches,
            usernameLength: usernameInput.length,
            configuredUsernameLength: configuredUsername.length,
            passwordLength: passwordInput.length,
            configuredPasswordLength: configuredPassword.length,
          });
          return null;
        }

        const email = getBasicAuthEmail(usernameInput);
        return {
          id: `basic:${configuredUsername.toLowerCase()}`,
          name: configuredUsername,
          email,
        };
      },
    })
  );
}

const authConfig = {
  providers,
  pages: {
    signIn: "/signin",
    error: "/auth/error",
  },
  trustHost: true,
  ...(secret ? { secret } : {}),
} satisfies NextAuthConfig;

export default authConfig;
