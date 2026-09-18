import * as React from "react";
import Link from "next/link";
import { ProductImage } from "@/components/product-image";
import { cn } from "@/lib/utils";

/**
 * Dashboard surface primitives: one card shape, one row shape.
 * Every dashboard list (sticker queue, counter activity, movers, alerts) is
 * built from these so the page reads as a single rhythm - 48px card header,
 * 64px rows, 44px footer strip.
 */

export function SectionCard({
  title,
  meta,
  action,
  footerHref,
  footerLabel,
  bodyClassName,
  children,
}: {
  title?: string;
  meta?: string;
  action?: React.ReactNode;
  footerHref?: string;
  footerLabel?: string;
  bodyClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border/60 bg-card shadow-none">
      {title ? (
        <div className="flex h-12 items-center justify-between gap-3 border-b border-border/60 px-4">
          <div className="flex min-w-0 items-baseline gap-2">
            <h2 className="text-sm font-semibold text-foreground">{title}</h2>
            {meta ? (
              <span className="truncate text-xs tabular-nums text-muted-foreground">{meta}</span>
            ) : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      ) : null}
      <div className={cn(bodyClassName)}>{children}</div>
      {footerHref && footerLabel ? (
        <Link
          href={footerHref}
          className="flex h-11 items-center justify-center border-t border-border/60 text-xs font-medium text-primary hover:bg-muted/40"
        >
          {footerLabel}
        </Link>
      ) : null}
    </section>
  );
}

export function StatCard({
  label,
  value,
  sub,
  href,
}: {
  label: string;
  value: string;
  sub?: string;
  href?: string;
}) {
  // A KPI whose value is words, not a number, must not shout at 24px.
  const isNumber = /\d/.test(value);
  const card = (
    <div
      className={cn(
        "rounded-lg border border-border/60 bg-card px-4 py-3.5",
        href && "transition-colors hover:border-primary/40"
      )}
    >
      <p className="truncate text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
        {label}
      </p>
      {/* Fixed value band keeps all four KPI cards exactly the same height. */}
      <p
        className={cn(
          "mt-1.5 flex h-8 items-end truncate",
          isNumber
            ? "text-2xl font-semibold tracking-[-0.02em] tabular-nums text-foreground"
            : "text-sm font-medium text-foreground"
        )}
      >
        {value}
      </p>
      <p className="mt-0.5 truncate text-xs text-muted-foreground">{sub ?? "—"}</p>
    </div>
  );
  return href ? (
    <Link href={href} className="block">
      {card}
    </Link>
  ) : (
    card
  );
}

export function Row({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "group relative flex h-16 items-center gap-3 border-b border-border/60 px-4 transition-colors last:border-0 hover:bg-muted/40",
        className
      )}
    >
      {children}
    </div>
  );
}

export function RowThumb({
  productId,
  imageUrl,
  name,
}: {
  productId: number;
  imageUrl?: string | null;
  name: string;
}) {
  return (
    <div className="flex w-8 shrink-0 justify-center">
      <ProductImage
        productId={productId}
        imageUrl={imageUrl}
        name={name}
        className="h-11 w-8 rounded-[3px] border-border/70 bg-muted"
      />
    </div>
  );
}

export function RowIcon({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex w-8 shrink-0 items-center justify-center text-muted-foreground">
      {children}
    </div>
  );
}

export function RowBody({ children }: { children: React.ReactNode }) {
  return <div className="flex min-w-0 flex-1 flex-col gap-0.5">{children}</div>;
}

export function RowTitle({
  href,
  children,
  title,
}: {
  href?: string;
  children: React.ReactNode;
  title?: string;
}) {
  if (!href) {
    return (
      <p className="truncate text-sm font-medium text-foreground" title={title}>
        {children}
      </p>
    );
  }
  return (
    <Link
      href={href}
      title={title}
      className="truncate text-sm font-medium text-foreground hover:underline after:absolute after:inset-0"
    >
      {children}
    </Link>
  );
}

export function RowMeta({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p className={cn("truncate text-xs text-muted-foreground", className)}>{children}</p>
  );
}

export function RowRail({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex shrink-0 flex-col items-end gap-0.5 text-right tabular-nums",
        "min-w-[76px] md:min-w-[104px]",
        className
      )}
    >
      {children}
    </div>
  );
}

export function RowActions({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        // Touch always shows the action; desktop reveals it on hover/focus, and
        // keeps it up while an overflow menu spawned from it is open.
        "relative z-10 flex shrink-0 items-center justify-end gap-1 transition-opacity",
        "md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100",
        "md:has-[[data-state=open]]:opacity-100",
        className
      )}
    >
      {children}
    </div>
  );
}

export function EmptyRows({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-4 py-10 text-center text-sm text-muted-foreground">{children}</p>
  );
}
