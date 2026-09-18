import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * A badge means EXCEPTION (sealed, foil, flagged, low stock, unmatched, needs
 * sticker). A value that shows up on most rows is not a badge.
 *
 * Three real variants: neutral / attention / critical. The older names are
 * kept as aliases so in-flight callers keep compiling, but they all resolve to
 * one of the three — nothing renders as a solid indigo pill any more, because
 * that competes with the single primary button on the page.
 */
const badgeVariants = cva(
  "inline-flex items-center rounded-[4px] border px-1.5 py-px text-[11px] font-medium leading-4 whitespace-nowrap",
  {
    variants: {
      variant: {
        neutral: "border-border bg-muted text-muted-foreground",
        attention: "border-warning/25 bg-warning/10 text-warning-foreground",
        critical: "border-destructive/25 bg-destructive/10 text-destructive",
        // Deprecated aliases.
        default: "border-border bg-muted text-muted-foreground",
        secondary: "border-border bg-muted text-muted-foreground",
        outline: "border-border bg-transparent text-muted-foreground",
        success: "border-border bg-muted text-muted-foreground",
        warning: "border-warning/25 bg-warning/10 text-warning-foreground",
        destructive: "border-destructive/25 bg-destructive/10 text-destructive",
      },
    },
    defaultVariants: { variant: "neutral" },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
