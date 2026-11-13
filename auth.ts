// Auth.js (next-auth v5, still tagged "beta") with Discord login and the Drizzle adapter.
// Config is a function so the DB client is only created per request, never at build time.
// Sessions are JWTs (cheap: no DB read per request). The adapter still stores users and accounts.
import NextAuth from "next-auth";
import Discord from "next-auth/providers/discord";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { accounts, authenticators, sessions, users, verificationTokens } from "@/db/schema";
import { getDb } from "@/lib/db";

declare module "next-auth" {
  interface Session {
    user: { id: string } & import("next-auth").DefaultSession["user"];
  }
}

/** True when everything login needs is configured. Pages check this to show setup help instead of erroring. */
export function authConfigured(): boolean {
  return Boolean(
    process.env.AUTH_SECRET &&
      process.env.AUTH_DISCORD_ID &&
      process.env.AUTH_DISCORD_SECRET &&
      process.env.DATABASE_URL,
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth(() => ({
  adapter: DrizzleAdapter(getDb(), {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
    authenticatorsTable: authenticators,
  }),
  providers: [
    Discord({
      clientId: process.env.AUTH_DISCORD_ID,
      clientSecret: process.env.AUTH_DISCORD_SECRET,
      // Discord's redirect carries an `iss` parameter (its OpenID config sets
      // authorization_response_iss_parameter_supported: true, issuer "https://discord.com"). The built-in
      // provider defines no issuer, so Auth.js compared against the placeholder "https://authjs.dev" and
      // failed with: unexpected "iss" (issuer) response parameter value. Endpoints stay explicit, so
      // setting this does not switch the provider to OIDC discovery.
      issuer: "https://discord.com",
    }),
  ],
  session: { strategy: "jwt" },
  callbacks: {
    // With JWT sessions the user id is the token subject; expose it on the session.
    session({ session, token }) {
      if (token.sub) session.user.id = token.sub;
      return session;
    },
  },
}));
