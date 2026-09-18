import { cn } from "@/lib/utils";

/**
 * Countertop brand mark: a rounded indigo-gradient tile with a "C".
 * Sized via className (e.g. "h-8 w-8 text-base", "h-12 w-12 text-xl").
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "flex h-8 w-8 shrink-0 select-none items-center justify-center rounded-lg bg-gradient-to-br from-primary to-primary-hover font-bold text-primary-foreground shadow-card",
        className
      )}
    >
      C
    </div>
  );
}
