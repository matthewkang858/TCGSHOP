import Link from "next/link";
import { requireStore } from "@/lib/tenancy";
import { signOut } from "@/auth";
import { Button } from "@/components/ui/button";
import { NavLinks } from "@/components/nav-links";
import { LogOut, Store } from "lucide-react";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await requireStore();

  async function signOutAction() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <div className="flex min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-40 flex w-56 flex-col border-r bg-card">
        <Link href="/dashboard" className="flex items-center gap-2 border-b px-4 py-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary font-bold text-primary-foreground">
            C
          </div>
          <span className="text-lg font-semibold tracking-tight">Countertop</span>
        </Link>
        <div className="flex items-center gap-2 border-b px-4 py-3 text-sm">
          <Store className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate font-medium" title={ctx.storeName}>
            {ctx.storeName}
          </span>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto p-2">
          <NavLinks />
        </nav>
        <div className="border-t p-3">
          <p className="mb-2 truncate px-1 text-xs text-muted-foreground" title={ctx.userEmail}>
            {ctx.userEmail}
          </p>
          <form action={signOutAction}>
            <Button variant="ghost" size="sm" className="w-full justify-start" type="submit">
              <LogOut />
              Sign out
            </Button>
          </form>
        </div>
      </aside>
      <main className="ml-56 flex-1 bg-muted/30">
        <div className="mx-auto max-w-7xl p-6">{children}</div>
      </main>
    </div>
  );
}
