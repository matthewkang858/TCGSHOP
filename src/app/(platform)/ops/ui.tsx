import { Database } from "lucide-react";
import { EmptyState } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Small internal-only presentation helpers. Anything that already exists in
 * `@/components/ui` is reused as-is; this file only adds the shapes the store
 * app has no use for (confidence axes, attestation split bars).
 */

/** 0..1 share as a percentage string. */
export function formatShare(value: number | string | null | undefined, digits = 1): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

/** Integer with thousands separators, or an em dash. */
export function formatCount(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return Math.round(n).toLocaleString("en-US");
}

export function safeDivide(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

/** "1 store" / "7 stores" — ops copy is dense enough without "1 stores". */
export function pluralize(
  count: number | string | null | undefined,
  singular: string,
  plural?: string
): string {
  const n = Number(count ?? NaN);
  if (!Number.isFinite(n)) return `— ${plural ?? `${singular}s`}`;
  return `${formatCount(n)} ${Math.abs(n) === 1 ? singular : (plural ?? `${singular}s`)}`;
}

/**
 * The calm state every ops page falls back to before the aggregation job has
 * ever run. It is not an error - there is simply nothing on the tape yet.
 */
export function NoTapeYet({
  what,
  detail,
}: {
  what: string;
  detail?: string;
}) {
  return (
    <EmptyState
      icon={<Database />}
      title={`No tape data yet — ${what}`}
      description={
        detail ??
        "The aggregation job has not produced any observations. Once stores record counter transactions and the job runs, this fills in."
      }
    />
  );
}

/** A horizontal 0..1 meter. Used for the per-axis confidence breakdown. */
export function AxisBar({
  label,
  value,
  hint,
  weak,
}: {
  label: string;
  value: number | null;
  hint?: string;
  weak?: boolean;
}) {
  const v = value === null || !Number.isFinite(value) ? null : Math.max(0, Math.min(1, value));
  return (
    <div className="py-2">
      <div className="flex items-baseline justify-between gap-3">
        <p className="truncate text-xs font-medium text-foreground">{label}</p>
        <p
          className={cn(
            "shrink-0 text-xs tabular-nums",
            weak ? "font-semibold text-destructive" : "text-muted-foreground"
          )}
        >
          {v === null ? "—" : v.toFixed(2)}
        </p>
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full", weak ? "bg-destructive" : "bg-primary")}
          style={{ width: `${(v ?? 0) * 100}%` }}
        />
      </div>
      {hint ? <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/**
 * Attested vs self-reported, as one bar. The left segment is the part of the
 * sample a payment processor vouched for; the right is the part that is a
 * store's word for it.
 */
export function AttestationBar({
  share,
  className,
}: {
  share: number;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(1, Number.isFinite(share) ? share : 0)) * 100;
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-muted", className)}>
      <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Label / value / sub, laid out inside a bordered grid cell. */
export function FactCell({
  label,
  value,
  sub,
  className,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("px-4 py-3.5", className)}>
      <p className="truncate text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1.5 truncate text-sm font-medium tabular-nums text-foreground">{value}</p>
      <p className="mt-0.5 truncate text-xs text-muted-foreground">{sub ?? "—"}</p>
    </div>
  );
}

/** A quiet note strip for the "this is aggregate only" reminders. */
export function AggregateNote({ children }: { children: React.ReactNode }) {
  return (
    <Card className="mb-4 border-dashed bg-transparent px-4 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
      {children}
    </Card>
  );
}

/** Confidence rendered as a number plus a tone, used in dense tables. */
export function confidenceTone(confidence: number): string {
  if (confidence >= 0.6) return "text-success";
  if (confidence >= 0.35) return "text-foreground";
  return "text-muted-foreground";
}
