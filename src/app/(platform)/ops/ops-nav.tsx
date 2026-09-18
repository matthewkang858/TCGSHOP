"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, ScanSearch, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The ops nav is deliberately three items on a horizontal bar. The store app
 * is a left sidebar with seven; the difference in shape is the fastest way to
 * tell, at a glance in a screenshot, that you are not looking at the product.
 */
export const opsNavLinks = [
  { href: "/ops", label: "Coverage", icon: Activity, exact: true },
  { href: "/ops/divergence", label: "Divergence", icon: ScanSearch, exact: false },
  { href: "/ops/quality", label: "Data quality", icon: ShieldAlert, exact: false },
];

export function OpsNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Platform ops" className="flex items-center gap-1">
      {opsNavLinks.map(({ href, label, icon: Icon, exact }) => {
        const active = exact
          ? pathname === href
          : pathname === href || pathname.startsWith(href + "/");
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium transition-colors",
              active
                ? "bg-white/12 text-white"
                : "text-white/60 hover:bg-white/8 hover:text-white/90"
            )}
          >
            <Icon className="size-3.5 shrink-0" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
