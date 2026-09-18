"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, CheckCircle2, CircleAlert, FileDown, FileUp, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FIELD_LABELS, IMPORT_FIELDS, REQUIRED_FIELDS, type ColumnMapping, type MappedRow } from "@/lib/import/mapping";
import {
  commitImportAction,
  matchRowsAction,
  parseCsvAction,
  type MatchResponse,
  type SerializedCandidate,
} from "./actions";
import { cn, formatMoney } from "@/lib/utils";

type Step = "upload" | "map" | "review" | "done";

type MatchData = Extract<MatchResponse, { ok: true }>;

const EYEBROW = "text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground";

export function ImportWizard() {
  const router = useRouter();
  const [step, setStep] = React.useState<Step>("upload");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [headers, setHeaders] = React.useState<string[]>([]);
  const [rows, setRows] = React.useState<Record<string, string>[]>([]);
  const [preset, setPreset] = React.useState<"tcgplayer" | "generic">("generic");
  const [mapping, setMapping] = React.useState<ColumnMapping>({});

  const [match, setMatch] = React.useState<MatchData | null>(null);
  // ambiguous resolutions: rowIndex -> chosen productId (or -1 = skip)
  const [resolutions, setResolutions] = React.useState<Record<number, number>>({});
  const [excluded, setExcluded] = React.useState<Set<number>>(new Set());
  const [committedCount, setCommittedCount] = React.useState(0);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.set("file", file);
    const res = await parseCsvAction(fd);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setHeaders(res.headers);
    setRows(res.rows);
    setPreset(res.preset);
    setMapping(res.mapping);
    setStep("map");
  }

  async function handleMatch() {
    setBusy(true);
    setError(null);
    const res = await matchRowsAction({ mapping, rows });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setMatch(res);
    setResolutions({});
    setExcluded(new Set());
    setStep("review");
  }

  async function handleCommit() {
    if (!match) return;
    setBusy(true);
    setError(null);
    const items: { row: MappedRow; productId: number }[] = [];
    for (const m of match.matched) {
      if (!excluded.has(m.row.rowIndex)) items.push({ row: m.row, productId: m.product.productId });
    }
    for (const a of match.ambiguous) {
      const pick = resolutions[a.row.rowIndex];
      if (pick && pick > 0) items.push({ row: a.row, productId: pick });
    }
    const res = await commitImportAction({ items });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setCommittedCount(res.count);
    setStep("done");
  }

  function downloadUnmatched() {
    if (!match) return;
    const lines = [
      "row,product_name,set_name,quantity,reason",
      ...match.unmatched.map((u) =>
        [
          u.row.rowIndex + 1,
          JSON.stringify(u.row.productName),
          JSON.stringify(u.row.setName ?? ""),
          u.row.quantity,
          JSON.stringify(u.reason),
        ].join(",")
      ),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "unmatched-rows.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const mappingValid = REQUIRED_FIELDS.every((f) => mapping[f]);

  return (
    <div className="space-y-4">
      <StepIndicator step={step} />
      {error ? (
        <div className="flex items-center gap-2 rounded-md border border-destructive/25 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <CircleAlert className="size-4 shrink-0" />
          {error}
        </div>
      ) : null}

      {step === "upload" ? (
        <Card>
          <CardHeader>
            <CardTitle>Upload inventory CSV</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <label
              className={cn(
                "flex cursor-pointer flex-col items-center justify-center rounded-md border border-dashed border-border px-6 py-10 text-center transition-colors hover:border-ring/50 hover:bg-muted/40",
                busy && "pointer-events-none opacity-60"
              )}
            >
              {busy ? (
                <Loader2 className="mb-3 size-5 animate-spin text-muted-foreground" />
              ) : (
                <FileUp className="mb-3 size-5 text-muted-foreground" />
              )}
              <span className="text-sm font-medium text-foreground">Choose a CSV file</span>
              <span className="mt-1 max-w-sm text-xs text-muted-foreground">
                TCGplayer exports are detected automatically · any other CSV maps by column ·
                sealed product supported
              </span>
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={handleUpload}
                disabled={busy}
              />
            </label>
            <p className="text-center text-xs text-muted-foreground">
              No export handy?{" "}
              <a
                href="/api/sample-inventory.csv"
                className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline"
              >
                <FileDown className="size-4" />
                Download a sample CSV
              </a>
            </p>
          </CardContent>
        </Card>
      ) : null}

      {step === "map" ? (
        <Card>
          <CardHeader>
            <CardTitle>Map columns</CardTitle>
            <span className="truncate text-xs text-muted-foreground">
              {preset === "tcgplayer" ? "TCGplayer export detected" : "Generic CSV"} ·{" "}
              {rows.length.toLocaleString()} rows
            </span>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2">
              {IMPORT_FIELDS.map((field) => (
                <div key={field} className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate text-sm font-medium text-foreground">
                    {FIELD_LABELS[field]}
                    {REQUIRED_FIELDS.includes(field) ? (
                      <span className="text-destructive"> *</span>
                    ) : null}
                  </span>
                  <Select
                    className="w-44 shrink-0"
                    aria-label={FIELD_LABELS[field]}
                    value={mapping[field] ?? ""}
                    onChange={(e) =>
                      setMapping((m) => ({ ...m, [field]: e.target.value || null }))
                    }
                  >
                    <option value="">— not mapped —</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </Select>
                </div>
              ))}
            </div>

            <div>
              <h4 className={cn("mb-2", EYEBROW)}>First rows of the file</h4>
              <div className="overflow-x-auto rounded-md border border-border/60">
                <Table>
                  <TableHeader>
                    <TableRow className="h-9 hover:bg-transparent">
                      {headers.slice(0, 6).map((h) => (
                        <TableHead key={h} title={h}>
                          <span className="block truncate">{h}</span>
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.slice(0, 4).map((r, i) => (
                      <TableRow key={i} className="h-10">
                        {headers.slice(0, 6).map((h) => (
                          <TableCell key={h} className="text-xs text-muted-foreground">
                            <span className="block truncate" title={r[h]}>
                              {r[h]}
                            </span>
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-4">
              <Button variant="ghost" onClick={() => setStep("upload")}>
                Back
              </Button>
              <Button onClick={handleMatch} disabled={!mappingValid || busy}>
                {busy ? <Loader2 className="animate-spin" /> : null}
                Match against catalog
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {step === "review" && match ? (
        <ReviewStep
          match={match}
          resolutions={resolutions}
          setResolutions={setResolutions}
          excluded={excluded}
          setExcluded={setExcluded}
          onBack={() => setStep("map")}
          onCommit={handleCommit}
          onDownloadUnmatched={downloadUnmatched}
          busy={busy}
        />
      ) : null}

      {step === "done" ? (
        <Card>
          <CardContent className="flex flex-col items-center py-10 text-center">
            <CheckCircle2 className="mb-3 size-5 text-success" />
            <h3 className="text-sm font-medium text-foreground">
              Imported{" "}
              <span className="tabular-nums">{committedCount.toLocaleString()}</span> inventory
              line{committedCount === 1 ? "" : "s"}
            </h3>
            <p className="mt-1 max-w-sm text-xs text-muted-foreground">
              Re-importing the same file updates quantities and prices — it never duplicates.
            </p>
            <div className="mt-4 flex gap-2">
              <Button onClick={() => router.push("/inventory")}>View inventory</Button>
              <Button variant="outline" onClick={() => window.location.reload()}>
                Import another file
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function StepIndicator({ step }: { step: Step }) {
  const steps: { key: Step; label: string }[] = [
    { key: "upload", label: "Upload" },
    { key: "map", label: "Map columns" },
    { key: "review", label: "Review" },
    { key: "done", label: "Done" },
  ];
  const idx = steps.findIndex((s) => s.key === step);
  return (
    <div className={cn("flex items-center gap-2", EYEBROW)}>
      {steps.map((s, i) => (
        <React.Fragment key={s.key}>
          {i > 0 ? <span className="h-px w-3 shrink-0 bg-border sm:w-5" aria-hidden /> : null}
          <span
            className={cn(
              "flex items-center gap-1.5",
              i === idx ? "text-foreground" : "text-muted-foreground"
            )}
            aria-current={i === idx ? "step" : undefined}
          >
            <span
              className={cn(
                "flex size-4 shrink-0 items-center justify-center rounded-full border text-[10px] leading-none tabular-nums",
                i === idx ? "border-foreground/40 text-foreground" : "border-border"
              )}
            >
              {i < idx ? <Check className="size-2.5" /> : i + 1}
            </span>
            {/* below sm, only the current step's label fits comfortably */}
            <span className={cn(i === idx ? "inline" : "hidden sm:inline")}>{s.label}</span>
          </span>
        </React.Fragment>
      ))}
    </div>
  );
}

/** Tab counts are facts, not badges: muted tabular numerals beside the label. */
function TabCount({ n }: { n: number }) {
  return <span className="ml-1.5 text-xs tabular-nums text-muted-foreground">{n.toLocaleString()}</span>;
}

function candidateLabel(c: SerializedCandidate) {
  return [c.name, c.number ? `#${c.number}` : null, c.expansionName, c.productType === "sealed" ? "sealed" : null]
    .filter(Boolean)
    .join(" · ");
}

function ReviewStep({
  match,
  resolutions,
  setResolutions,
  excluded,
  setExcluded,
  onBack,
  onCommit,
  onDownloadUnmatched,
  busy,
}: {
  match: MatchData;
  resolutions: Record<number, number>;
  setResolutions: React.Dispatch<React.SetStateAction<Record<number, number>>>;
  excluded: Set<number>;
  setExcluded: React.Dispatch<React.SetStateAction<Set<number>>>;
  onBack: () => void;
  onCommit: () => void;
  onDownloadUnmatched: () => void;
  busy: boolean;
}) {
  const resolvedCount = Object.values(resolutions).filter((v) => v > 0).length;
  const willImport = match.matched.length - excluded.size + resolvedCount;
  const needsAttention = match.unmatched.length + match.rowErrors.length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Review matches</CardTitle>
        <span className="truncate text-xs tabular-nums text-muted-foreground">
          {match.matched.length.toLocaleString()} matched · {match.ambiguous.length} ambiguous ·{" "}
          {needsAttention} need attention
        </span>
      </CardHeader>
      <CardContent className="space-y-4">
        <Tabs defaultValue={match.ambiguous.length > 0 ? "ambiguous" : "matched"}>
          <TabsList className="h-auto max-w-full flex-wrap justify-start">
            <TabsTrigger value="matched">
              Matched
              <TabCount n={match.matched.length} />
            </TabsTrigger>
            <TabsTrigger value="ambiguous">
              Ambiguous
              <TabCount n={match.ambiguous.length} />
            </TabsTrigger>
            <TabsTrigger value="unmatched">
              Unmatched
              <TabCount n={needsAttention} />
            </TabsTrigger>
          </TabsList>

          <TabsContent value="matched">
            <div className="max-h-96 overflow-y-auto rounded-md border border-border/60">
              <Table>
                <colgroup>
                  <col className="w-[52px]" />
                  <col className="w-[28%]" />
                  <col className="w-[38%]" />
                  <col className="w-[10%]" />
                  <col className="w-[14%]" />
                  <col className="w-[72px]" />
                </colgroup>
                <TableHeader sticky>
                  <TableRow className="h-9 hover:bg-transparent">
                    <TableHead>
                      <span className="sr-only">Import</span>
                    </TableHead>
                    <TableHead>CSV row</TableHead>
                    <TableHead>Matched product</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                    <TableHead>Via</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {match.matched.map((m) => (
                    <TableRow key={m.row.rowIndex} className="h-11">
                      <TableCell>
                        <input
                          type="checkbox"
                          className="size-4 accent-primary"
                          aria-label={`Import ${m.row.productName}`}
                          checked={!excluded.has(m.row.rowIndex)}
                          onChange={(e) =>
                            setExcluded((prev) => {
                              const next = new Set(prev);
                              if (e.target.checked) next.delete(m.row.rowIndex);
                              else next.add(m.row.rowIndex);
                              return next;
                            })
                          }
                        />
                      </TableCell>
                      <TableCell className="text-sm font-medium text-foreground">
                        <span className="block truncate" title={m.row.productName}>
                          {m.row.productName}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        <span className="block truncate" title={candidateLabel(m.product)}>
                          {candidateLabel(m.product)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right text-sm font-medium tabular-nums text-foreground">
                        {m.row.quantity}
                      </TableCell>
                      <TableCell className="text-right text-sm font-medium tabular-nums text-foreground">
                        {formatMoney(m.row.price ?? null)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {m.via === "exact_id" ? "ID" : "fuzzy"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          <TabsContent value="ambiguous">
            {match.ambiguous.length === 0 ? (
              <p className="py-10 text-center text-xs text-muted-foreground">
                Nothing ambiguous — clean file.
              </p>
            ) : (
              <div className="max-h-96 divide-y divide-border/60 overflow-y-auto rounded-md border border-border/60">
                {match.ambiguous.map((a) => (
                  <div key={a.row.rowIndex} className="p-3">
                    <p className="truncate text-sm font-medium text-foreground">
                      {a.row.productName}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {[a.row.setName, `${a.row.quantity} in row`].filter(Boolean).join(" · ")}
                    </p>
                    <Select
                      className="mt-2"
                      aria-label={`Resolve ${a.row.productName}`}
                      value={resolutions[a.row.rowIndex] ?? ""}
                      onChange={(e) =>
                        setResolutions((r) => ({
                          ...r,
                          [a.row.rowIndex]: Number(e.target.value),
                        }))
                      }
                    >
                      <option value="">— pick the right product or skip —</option>
                      {a.candidates.map((c) => (
                        <option key={c.productId} value={c.productId}>
                          {candidateLabel(c)}
                        </option>
                      ))}
                      <option value={-1}>Skip this row</option>
                    </Select>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="unmatched">
            {needsAttention === 0 ? (
              <p className="py-10 text-center text-xs text-muted-foreground">Every row matched.</p>
            ) : (
              <div className="space-y-3">
                <div className="max-h-80 overflow-y-auto rounded-md border border-border/60">
                  <Table>
                    <colgroup>
                      <col className="w-[45%]" />
                      <col className="w-[55%]" />
                    </colgroup>
                    <TableHeader sticky>
                      <TableRow className="h-9 hover:bg-transparent">
                        <TableHead>CSV row</TableHead>
                        <TableHead>Reason</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {match.unmatched.map((u) => (
                        <TableRow key={u.row.rowIndex} className="h-11">
                          <TableCell className="text-sm font-medium text-foreground">
                            <span className="block truncate" title={u.row.productName}>
                              {u.row.productName}
                            </span>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            <span className="block truncate" title={u.reason}>
                              {u.reason}
                            </span>
                          </TableCell>
                        </TableRow>
                      ))}
                      {match.rowErrors.map((e) => (
                        <TableRow key={`err-${e.rowIndex}`} className="h-11">
                          <TableCell className="text-sm font-medium tabular-nums text-foreground">
                            Row {e.rowIndex + 1}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            <span className="block truncate" title={e.error}>
                              {e.error}
                            </span>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {match.unmatched.length > 0 ? (
                  <Button variant="outline" size="sm" onClick={onDownloadUnmatched}>
                    Download unmatched rows
                  </Button>
                ) : null}
              </div>
            )}
          </TabsContent>
        </Tabs>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-4">
          <Button variant="ghost" onClick={onBack}>
            Back
          </Button>
          <div className="flex items-center gap-3">
            <span className="text-xs tabular-nums text-muted-foreground">
              {willImport.toLocaleString()} lines will be imported
            </span>
            <Button onClick={onCommit} disabled={busy || willImport === 0}>
              {busy ? <Loader2 className="animate-spin" /> : null}
              Import {willImport.toLocaleString()} lines
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
