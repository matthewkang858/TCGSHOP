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
          className="flex h-14 items-center gap-2.5 border-b border-sidebar-border px-4"
        >
          <BrandMark className="h-7 w-7 text-sm" />
          <span className="text-sm font-semibold tracking-[-0.01em]">Countertop</span>
        </Link>
        <div className="flex h-11 items-center gap-2 border-b border-sidebar-border px-4">
          <Store className="size-4 shrink-0 text-sidebar-muted" />
          <span className="truncate text-xs font-medium" title={ctx.storeName}>
            {ctx.storeName}
          </span>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
          <NavLinks />
        </nav>
        <div className="border-t border-sidebar-border p-2">
          <p
            className="mb-1 truncate px-2 py-1 text-[11px] text-sidebar-muted"
            title={ctx.userEmail}
          >
            {ctx.userEmail}
          </p>
          <form action={signOutAction}>
            <Button
              variant="ghost"
              className="h-9 w-full justify-start px-3 text-sm text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground"
              type="submit"
            >
              <LogOut />
              Sign out
            </Button>
          </form>
        </div>
      </aside>
      <header className="fixed inset-x-0 top-0 z-30 flex h-12 items-center gap-2.5 border-b border-border bg-card px-4 md:hidden">
        <Link href="/dashboard" className="flex items-center gap-2">
          <BrandMark className="h-6 w-6 text-xs" />
          <span className="text-sm font-semibold tracking-[-0.01em]">Countertop</span>
        </Link>
        <span
          className="ml-auto truncate text-xs text-muted-foreground"
          title={ctx.storeName}
        >
          {ctx.storeName}
        </span>
      </header>
      <main className="min-w-0 flex-1 md:ml-56">
        {/* pt-16 clears the fixed mobile header; pb-24 clears the bottom tab bar. */}
        <div className="mx-auto w-full max-w-[1360px] px-4 pb-24 pt-16 md:px-6 md:pb-8 md:pt-6 lg:px-8">
          {children}
        </div>
      </main>
      <MobileTabBar userEmail={ctx.userEmail} signOutAction={signOutAction} />
    </div>
  );
}
