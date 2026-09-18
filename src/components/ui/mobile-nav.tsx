"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { HandCoins, LogOut, MoreHorizontal, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { navLinks } from "@/components/nav-links";

const tabHrefs = ["/dashboard", "/inventory", "/repricing"];
const moreHrefs = ["/products", "/alerts", "/settings"];

function byHref(href: string) {
  return navLinks.find((l) => l.href === href)!;
}

export function MobileTabBar({
  userEmail,
  signOutAction,
}: {
  userEmail: string;
  signOutAction: () => Promise<void>;
}) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = React.useState(false);

  // Close the More panel whenever navigation happens.
  React.useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + "/");
  const moreActive = moreHrefs.some(isActive);

  const [dashboard, inventory] = [byHref("/dashboard"), byHref("/inventory")];
  const repricing = byHref("/repricing");

  const tabClass = (active: boolean) =>
    cn(
      "flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium transition-colors",
      active ? "text-primary" : "text-muted-foreground"
    );

  return (
    <>
      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t bg-card pb-[env(safe-area-inset-bottom)] shadow-float md:hidden"
        aria-label="Primary"
      >
        <div className="flex h-16 items-stretch">
          {[dashboard, inventory].map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} className={tabClass(isActive(href))}>
              <Icon className="h-5 w-5" />
              {label}
            </Link>
          ))}
          <Link
            href="/transactions"
            className="flex flex-1 flex-col items-center justify-end gap-0.5 pb-2"
          >
            <span
              className={cn(
                "-mt-5 flex h-13 w-13 items-center justify-center rounded-full text-primary-foreground shadow-float transition-colors",
                isActive("/transactions") ? "bg-primary-hover" : "bg-primary"
              )}
            >
              <HandCoins className="h-6 w-6" />
            </span>
            <span
              className={cn(
                "text-[11px] font-medium",
                isActive("/transactions") ? "text-primary" : "text-muted-foreground"
              )}
            >
              Sell
            </span>
          </Link>
          <Link
            href={repricing.href}
            className={tabClass(isActive(repricing.href))}
          >
            <repricing.icon className="h-5 w-5" />
            {repricing.label}
          </Link>
          <button
            type="button"
            onClick={() => setMoreOpen((v) => !v)}
            className={tabClass(moreActive || moreOpen)}
            aria-expanded={moreOpen}
          >
            <MoreHorizontal className="h-5 w-5" />
            More
          </button>
        </div>
      </nav>

      {moreOpen ? (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/50 md:hidden"
            onClick={() => setMoreOpen(false)}
            aria-hidden
          />
          <div className="fixed inset-x-0 bottom-0 z-40 rounded-t-xl border bg-card pb-[calc(env(safe-area-inset-bottom)+0.75rem)] shadow-float md:hidden">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <p className="truncate text-sm font-medium text-muted-foreground" title={userEmail}>
                {userEmail}
              </p>
              <button
                type="button"
                onClick={() => setMoreOpen(false)}
                className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="h-4 w-4" />
                <span className="sr-only">Close</span>
              </button>
            </div>
            <div className="space-y-1 p-2">
              {moreHrefs.map((href) => {
                const { label, icon: Icon } = byHref(href);
                return (
                  <Link
                    key={href}
                    href={href}
                    className={cn(
                      "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
                      isActive(href)
                        ? "bg-accent text-accent-foreground"
                        : "text-foreground hover:bg-accent"
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {label}
                  </Link>
                );
              })}
              <form action={signOutAction}>
                <button
                  type="submit"
                  className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <LogOut className="h-4 w-4" />
                  Sign out
                </button>
              </form>
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}
