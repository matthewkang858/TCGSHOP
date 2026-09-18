import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, Lock } from "lucide-react";
import { requirePlatformAdmin } from "@/lib/platform";
import { OpsNav } from "./ops-nav";

export const metadata: Metadata = {
  title: "Platform ops",
  // Internal surface: never index it, never follow out of it.
  robots: { index: false, follow: false },
};

/**
 * Internal chrome for the platform operator.
 *
 * Re-skinned, not redesigned: every primitive under `@/components/ui` is the
 * same one the store app uses, so tables, cards and badges keep their rhythm.
 * What changes is the shell — a teal accent instead of indigo, a top bar
 * instead of a left sidebar, and an amber "internal" strip that is the first
 * thing in the viewport. The accent swap is done by overriding the design
 * tokens on this subtree, so `bg-primary`, `text-primary` and the charts all
 * follow along without touching the shared components.
 */
const opsTheme = {
  "--primary": "hsl(187 84% 24%)",
  "--primary-hover": "hsl(187 84% 18%)",
  "--primary-foreground": "hsl(0 0% 100%)",
  "--ring": "hsl(187 84% 28%)",
  "--accent": "hsl(187 52% 92%)",
  "--accent-foreground": "hsl(187 80% 18%)",
  "--surface-subtle": "hsl(195 30% 97%)",
} as React.CSSProperties;

export default async function PlatformOpsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const admin = await requirePlatformAdmin();

  return (
    <div style={opsTheme} className="min-h-screen bg-[hsl(198_28%_96%)]">
      {/* The strip you cannot miss. Nothing below it is store-facing. */}
      <div className="flex min-h-8 items-center justify-center gap-2 bg-[hsl(38_92%_50%)] px-4 py-1.5 text-center text-[11px] font-semibold uppercase tracking-[0.12em] text-[hsl(30_80%_14%)]">
        <Lock className="size-3 shrink-0" />
        <span>Platform ops · internal</span>
      </div>

      <header className="sticky top-0 z-30 border-b border-black/20 bg-[hsl(197_42%_13%)]">
        <div className="mx-auto flex w-full max-w-[1160px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 md:px-6">
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              aria-hidden
              className="flex size-7 shrink-0 select-none items-center justify-center rounded-md bg-[hsl(187_84%_34%)] text-[13px] font-semibold text-white"
            >
              T
            </span>
            <div className="min-w-0 leading-tight">
              <p className="truncate text-[13px] font-semibold text-white">The tape</p>
              <p className="truncate text-[11px] text-white/50">Operator console</p>
            </div>
          </div>

          <div className="order-last w-full md:order-none md:w-auto">
            <OpsNav />
          </div>

          <div className="ml-auto flex items-center gap-3">
            <p className="hidden max-w-[180px] truncate text-[11px] text-white/45 sm:block" title={admin.email}>
              {admin.email}
            </p>
            <Link
              href="/dashboard"
              className="flex items-center gap-1 text-[11px] font-medium text-white/60 transition-colors hover:text-white"
            >
              Store app
              <ArrowUpRight className="size-3" />
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1160px] px-4 pb-16 pt-6 md:px-6">
        {children}
      </main>

      <footer className="mx-auto w-full max-w-[1160px] px-4 pb-10 text-[11px] leading-relaxed text-muted-foreground md:px-6">
        Every number on this console is aggregated across all contributing
        stores. Individual stores are never named, identified or linkable from
        here — only counted.
      </footer>
    </div>
  );
}
