"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bell,
  Boxes,
  HandCoins,
  LayoutDashboard,
  Library,
  Settings,
  Tags,
} from "lucide-react";
import { cn } from "@/lib/utils";

// Single source of truth for app navigation; the mobile tab bar reuses it.
export const navLinks = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/transactions", label: "Sell / Buy", icon: HandCoins },
  { href: "/inventory", label: "Inventory", icon: Boxes },
  { href: "/products", label: "Catalog", icon: Library },
  { href: "/repricing", label: "Repricing", icon: Tags },
  { href: "/alerts", label: "Alerts", icon: Bell },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function NavLinks() {
  const pathname = usePathname();
  return (
    <>
      {navLinks.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(href + "/");
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex h-9 items-center gap-2.5 rounded-md px-3 text-sm font-medium transition-colors",
              active
                ? "bg-primary text-primary-foreground"
                : "text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground"
            )}
          >
            <Icon className="size-4 shrink-0" />
            {label}
          </Link>
        );
      })}
    </>
  );
}
