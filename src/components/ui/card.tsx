import * as React from "react";
import { cn } from "@/lib/utils";

function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border/60 bg-card text-card-foreground shadow-none",
        className
      )}
      {...props}
    />
  );
}

/** Fixed 48px title row. Left = CardTitle (+ optional count), right = at most one action. */
function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex h-12 items-center justify-between gap-3 border-b border-border/60 px-4",
        className
      )}
      {...props}
    />
  );
}

function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("text-sm font-semibold leading-none text-foreground", className)}
      {...props}
    />
  );
}

function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("text-xs text-muted-foreground", className)} {...props} />;
}

/** Use p-0 when the body is a list or a table — rows own their padding. */
function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-4", className)} {...props} />;
}

/** The "View all" strip; only rendered when the card's content is truncated. */
function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex h-11 items-center justify-center border-t border-border/60 px-4",
        className
      )}
      {...props}
    />
  );
}

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter };
