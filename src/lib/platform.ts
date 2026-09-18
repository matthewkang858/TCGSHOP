import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getSessionUser } from "@/lib/tenancy";

/**
 * Platform-operator access. This is NOT tenancy - it is the orthogonal axis:
 * a store owner is scoped *down* to their store, a platform admin is scoped
 * *across* every store at once.
 *
 * `users.platform_admin` is checked against the database on every request, the
 * same way membership is in `tenancy.ts`. Nothing about admin status is ever
 * carried in a cookie or a session claim, because the ops surface reads the
 * whole tape and a stale/forged claim would be a cross-tenant leak.
 *
 * Failure mode is deliberately a redirect, never a 403: a store owner who
 * pokes at /ops should see their dashboard, not proof that an internal
 * surface exists behind that URL.
 */

export type PlatformAdmin = {
  userId: string;
  email: string;
};

async function lookupAdmin(userId: string): Promise<PlatformAdmin | null> {
  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      platformAdmin: users.platformAdmin,
    })
    .from(users)
    .where(eq(users.id, userId));

  if (!row || !row.platformAdmin) return null;
  return { userId: row.id, email: row.email ?? "" };
}

/** The signed-in user when they are a platform operator, otherwise null. */
export async function getPlatformAdmin(): Promise<PlatformAdmin | null> {
  const user = await getSessionUser();
  if (!user) return null;
  return lookupAdmin(user.id);
}

/**
 * Platform operator or redirect. Use at the top of every /ops surface.
 * Signed out -> /login. Signed in but not an operator -> /dashboard, so the
 * surface never announces itself.
 */
export async function requirePlatformAdmin(): Promise<PlatformAdmin> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const admin = await lookupAdmin(user.id);
  if (!admin) redirect("/dashboard");
  return admin;
}
