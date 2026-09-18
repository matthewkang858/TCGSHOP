import * as React from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * The standard section card: 48px title row, then the body. `subtitle` is the
 * quiet count/fact that sits beside the title ("48", "last 30 days") — never a
 * badge. `action` is at most ONE thing: a ghost text link or a single select.
 * Pass `padded` when the body is prose or a form; leave it off when the body
 * is a list or a table, because rows own their own padding.
 */
export function Section({
  title,
  subtitle,
  action,
  footer,
  padded = false,
  className,
  contentClassName,
  children,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
  footer?: React.ReactNode;
  padded?: boolean;
  className?: string;
  contentClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardHeader>
        <div className="flex min-w-0 items-baseline gap-2">
          <CardTitle className="truncate">{title}</CardTitle>
          {subtitle ? (
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {subtitle}
            </span>
          ) : null}
        </div>
        {action ? <div className="flex shrink-0 items-center">{action}</div> : null}
      </CardHeader>
      <CardContent className={cn(padded ? "p-4" : "p-0", contentClassName)}>
        {children}
      </CardContent>
      {footer}
    </Card>
  );
}

/** The card footer strip shown only when the card is truncating its list. */
export function SectionFooterLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="flex h-11 items-center justify-center border-t border-border/60 text-xs font-medium text-primary hover:bg-muted/40"
    >
      {children}
    </Link>
  );
}
