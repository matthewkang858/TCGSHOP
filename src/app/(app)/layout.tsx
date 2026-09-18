import Link from "next/link";
import { requireStore } from "@/lib/tenancy";
import { signOut } from "@/auth";
import { Button } from "@/components/ui/button";
import { BrandMark } from "@/components/ui/logo";
import { MobileTabBar } from "@/components/ui/mobile-nav";
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
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-56 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex">
        <Link
          href="/dashboard"
          className="flex items-center gap-2.5 border-b border-sidebar-border px-4 py-4"
        >
          <BrandMark />
          <span className="text-lg font-semibold tracking-tight">Countertop</span>
        </Link>
        <div className="flex items-center gap-2 border-b border-sidebar-border px-4 py-3 text-sm">
          <Store className="h-4 w-4 shrink-0 text-sidebar-muted" />
          <span className="truncate font-medium" title={ctx.storeName}>
            {ctx.storeName}
          </span>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto p-2">
          <NavLinks />
        </nav>
        <div className="border-t border-sidebar-border p-3">
          <p className="mb-2 truncate px-1 text-xs text-sidebar-muted" title={ctx.userEmail}>
            {ctx.userEmail}
          </p>
          <form action={signOutAction}>
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground"
              type="submit"
            >
              <LogOut />
              Sign out
            </Button>
          </form>
        </div>
      </aside>
      <header className="fixed inset-x-0 top-0 z-30 flex h-12 items-center gap-2.5 border-b bg-card px-4 md:hidden">
        <Link href="/dashboard" className="flex items-center gap-2">
          <BrandMark className="h-7 w-7 text-sm" />
          <span className="font-semibold tracking-tight">Countertop</span>
        </Link>
        <span
          className="ml-auto truncate text-sm font-medium text-muted-foreground"
          title={ctx.storeName}
        >
          {ctx.storeName}
        </span>
      </header>
      <main className="flex-1 md:ml-56">
        <div className="mx-auto max-w-7xl p-4 pt-16 pb-24 md:p-6">{children}</div>
      </main>
      <MobileTabBar userEmail={ctx.userEmail} signOutAction={signOutAction} />
    </div>
  );
}
