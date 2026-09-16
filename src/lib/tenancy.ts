import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { memberships, stores } from "@/db/schema";

const ACTIVE_STORE_COOKIE = "countertop_store";

export type StoreContext = {
  userId: string;
  userEmail: string;
  storeId: string;
  storeName: string;
  role: "owner" | "member";
  settings: typeof stores.$inferSelect.settings;
};

/** Signed-in user or null. */
export async function getSessionUser() {
  const session = await auth();
  if (!session?.user?.id) return null;
  return { id: session.user.id, email: session.user.email ?? "" };
}

/** Signed-in user or redirect to /login. */
export async function requireUser() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

/**
 * Resolve the active store for the signed-in user.
 * Membership is ALWAYS verified against the database - the cookie is only a
 * selector between stores the user actually belongs to.
 * Returns null when the user has no store yet (-> onboarding).
 */
export async function getStoreContext(): Promise<StoreContext | null> {
  const user = await getSessionUser();
  if (!user) return null;

  const rows = await db
    .select({
      storeId: memberships.storeId,
      role: memberships.role,
      storeName: stores.name,
      settings: stores.settings,
    })
    .from(memberships)
    .innerJoin(stores, eq(stores.id, memberships.storeId))
    .where(eq(memberships.userId, user.id));

  if (rows.length === 0) return null;

  const cookieStore = await cookies();
  const preferred = cookieStore.get(ACTIVE_STORE_COOKIE)?.value;
  const active = rows.find((r) => r.storeId === preferred) ?? rows[0];

  return {
    userId: user.id,
    userEmail: user.email,
    storeId: active.storeId,
    storeName: active.storeName,
    role: active.role,
    settings: active.settings,
  };
}

/** Store context or redirect (login / onboarding). Use at the top of every app page. */
export async function requireStore(): Promise<StoreContext> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const ctx = await getStoreContext();
  if (!ctx) redirect("/onboarding");
  return ctx;
}

/**
 * Server-action guard: verify the CALLER is a member of storeId.
 * Every mutating server action must call this before touching store data.
 */
export async function assertMembership(storeId: string) {
  const user = await requireUser();
  const [row] = await db
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.userId, user.id), eq(memberships.storeId, storeId)));
  if (!row) throw new Error("Not a member of this store");
  return { userId: user.id, role: row.role };
}

export { ACTIVE_STORE_COOKIE };
