import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Desktop-only data table. `table-fixed` is mandatory and every table must
 * carry a <colgroup> — that is what stops a long set name from rewrapping a
 * row and breaking the 56px rhythm. Below md, render list rows instead.
 */
function Table({ className, ...props }: React.HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="relative w-full">
      <table className={cn("w-full table-fixed text-sm", className)} {...props} />
    </div>
  );
}

function TableHeader({
  className,
  sticky,
  ...props
}: React.HTMLAttributes<HTMLTableSectionElement> & { sticky?: boolean }) {
  return (
    <thead
      className={cn(
        "bg-surface-subtle [&_th]:border-b [&_th]:border-border-strong",
        sticky && "sticky top-0 z-10",
        className
      )}
      {...props}
    />
  );
}

function TableBody({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn("[&_tr:last-child_td]:border-0", className)} {...props} />;
}

function TableRow({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn(
        "group h-14 transition-colors hover:bg-muted/40 data-[state=selected]:bg-muted",
        className
      )}
      {...props}
    />
  );
}

function TableHead({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        "h-9 px-3 text-left align-middle text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground whitespace-nowrap first:pl-4 last:pr-4",
        className
      )}
      {...props}
    />
  );
}

function TableCell({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className={cn(
        "border-b border-border/60 px-3 py-0 align-middle whitespace-nowrap first:pl-4 last:pr-4",
        className
      )}
      {...props}
    />
  );
}

export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell };
