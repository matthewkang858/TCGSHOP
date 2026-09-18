"use server";

import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { sessions, users } from "@/db/schema";
import { env } from "@/lib/env";

const DEMO_EMAIL = "demo@countertop.local";

/**
 * One-click demo sign-in, only when DEMO_LOGIN=true. Creates a real database
 * session for the seeded demo user and sets the Auth.js session cookie, so
 * everything downstream (requireStore etc.) behaves exactly like a normal
 * login. Sessions expire after 7 days.
 */
export async function demoLoginAction() {
  if (!env.DEMO_LOGIN) redirect("/login");

  const [user] = await db.select().from(users).where(eq(users.email, DEMO_EMAIL));
  if (!user) {
    redirect("/login?error=" + encodeURIComponent("Demo store not seeded yet"));
  }

  const token = randomUUID();
  const expires = new Date(Date.now() + 7 * 24 * 3600_000);
  await db.insert(sessions).values({ sessionToken: token, userId: user.id, expires });

  // Auth.js prefixes the cookie with __Secure- on HTTPS deployments
  const secure = env.APP_URL.startsWith("https://");
  const cookieStore = await cookies();
  cookieStore.set(secure ? "__Secure-authjs.session-token" : "authjs.session-token", token, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    expires,
  });

  redirect("/dashboard");
}
