import NextAuth from "next-auth";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { db } from "@/db";
import {
  users,
  accounts,
  sessions,
  verificationTokens,
} from "@/db/schema";
import { env } from "@/lib/env";
import { sendEmail } from "@/lib/notify/email";

/**
 * Auth.js with email magic links.
 * With RESEND_API_KEY set, links are emailed via Resend; otherwise the
 * link is logged to the server console (dev flow).
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  secret: env.AUTH_SECRET,
  session: { strategy: "database" },
  pages: {
    signIn: "/login",
    verifyRequest: "/login/check-email",
  },
  providers: [
    {
      id: "email",
      type: "email",
      name: "Email",
      from: env.EMAIL_FROM,
      maxAge: 24 * 60 * 60,
      options: {},
      async sendVerificationRequest({ identifier, url }) {
        await sendEmail({
          to: identifier,
          subject: "Sign in to Countertop",
          html: `<p>Click the link below to sign in to Countertop:</p><p><a href="${url}">Sign in</a></p><p>If you didn't request this, ignore this email.</p>`,
          consoleFallback: `\n🔑 Magic sign-in link for ${identifier}:\n${url}\n`,
        });
      },
    },
  ],
});
