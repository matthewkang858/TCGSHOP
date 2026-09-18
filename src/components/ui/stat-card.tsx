import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

export type StatTone = "neutral" | "positive" | "negative";

const toneClass: Record<StatTone, string> = {
  neutral: "text-muted-foreground",
  positive: "text-success",
  negative: "text-destructive",
};

/**
 * The only card variant besides Card: label / value / sub, no icon, no colour,
 * no header. Every KPI in a row must pass a `sub` (use "—" when there is
 * nothing to say) so all four cards end up exactly the same height.
 *
 * A value that is words rather than a number ("Not yet run") drops to T4 — a
 * non-number must never be the loudest thing on the screen.
 */
export function StatCard({
  label,
  value,
  sub,
  tone = "neutral",
  href,
  className,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: StatTone;
  href?: string;
  className?: string;
}) {
  const isNumeric = typeof value !== "string" || /\d/.test(value);

  const body = (
    <>
      <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          "mt-1.5 truncate text-foreground",
          isNumeric
            ? "text-2xl font-semibold tracking-[-0.02em] tabular-nums"
            : "text-sm font-medium"
        )}
      >
        {value}
      </p>
      <p className={cn("mt-0.5 truncate text-xs tabular-nums", toneClass[tone])}>
        {sub ?? "—"}
      </p>
    </>
  );

  const shell = cn(
    "block rounded-lg border border-border/60 bg-card px-4 py-3.5",
    href && "transition-colors hover:bg-muted/40",
    className
  );

  if (href) {
    return (
      <Link href={href} className={shell}>
        {body}
      </Link>
    );
  }
  return <div className={shell}>{body}</div>;
}
