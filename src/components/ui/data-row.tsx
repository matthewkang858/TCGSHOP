import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

export type RowTone = "neutral" | "positive" | "negative";

const toneClass: Record<RowTone, string> = {
  neutral: "text-muted-foreground",
  positive: "text-success",
  negative: "text-destructive",
};

/**
 * The one list row in the product — sticker queue, top movers, alerts feed,
 * counter activity, and the mobile fallbacks for the ledger / inventory /
 * catalog tables all render this, at the same fixed 64px height.
 *
 * Anatomy: 32px leading rail (card thumbnail or a single lucide icon) ·
 * two-line identity · right-aligned numeric rail · one action.
 */
export function DataRow({
  image,
  title,
  badge,
  meta,
  value,
  valueMeta,
  tone = "neutral",
  actions,
  href,
  className,
}: {
  image?: React.ReactNode;
  title: React.ReactNode;
  badge?: React.ReactNode;
  meta?: React.ReactNode;
  value?: React.ReactNode;
  valueMeta?: React.ReactNode;
  tone?: RowTone;
  actions?: React.ReactNode;
  href?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "group relative flex h-16 items-center gap-3 border-b border-border/60 px-4 transition-colors last:border-0 hover:bg-muted/40",
        className
      )}
    >
      {image ? (
        <div className="flex w-8 shrink-0 items-center justify-center text-muted-foreground">
          {image}
        </div>
      ) : null}

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center">
          {href ? (
            // Stretched link: the whole row is the target, action buttons sit above it.
            <Link
              href={href}
              className="truncate text-sm font-medium text-foreground hover:underline after:absolute after:inset-0"
            >
              {title}
            </Link>
          ) : (
            <span className="truncate text-sm font-medium text-foreground">{title}</span>
          )}
          {badge ? <span className="ml-2 shrink-0">{badge}</span> : null}
        </div>
        {meta ? (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{meta}</p>
        ) : null}
      </div>

      {value !== undefined && value !== null ? (
        <div className="min-w-[104px] shrink-0 text-right">
          <p className="truncate text-sm font-medium tabular-nums text-foreground">{value}</p>
          {valueMeta ? (
            <p
              className={cn(
                "mt-0.5 truncate text-xs font-medium tabular-nums",
                toneClass[tone]
              )}
            >
              {valueMeta}
            </p>
          ) : null}
        </div>
      ) : null}

      {actions ? (
        // Always visible: hover-reveal hides the row's whole purpose (the
        // sticker queue's "mark updated" is the feature), and there is no
        // hover on the phones clerks actually use. One quiet button is not
        // the noise problem - twelve stacked full-width ones were.
        <div className="relative z-10 flex w-[84px] shrink-0 items-center justify-end gap-1">
          {actions}
        </div>
      ) : null}
    </div>
  );
}

/** 2.5:3.5 card-shaped thumbnail slot used by the row's leading rail. */
export const dataRowThumbClass =
  "h-11 w-8 rounded-[3px] border border-border/70 bg-muted object-cover";
