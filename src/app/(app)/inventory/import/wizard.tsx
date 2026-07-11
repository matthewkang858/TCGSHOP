"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, CircleAlert, FileUp, HelpCircle, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
        <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <CircleAlert className="h-4 w-4 shrink-0" />
          {error}
        </div>
      ) : null}

      {step === "upload" ? (
        <Card>
          <CardHeader>
            <CardTitle>Upload inventory CSV</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <label
              className={cn(
                "flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-14 text-center transition-colors hover:border-primary/60 hover:bg-accent/40",
                busy && "pointer-events-none opacity-60"
              )}
            >
              {busy ? (
                <Loader2 className="mb-3 h-8 w-8 animate-spin text-muted-foreground" />
              ) : (
                <FileUp className="mb-3 h-8 w-8 text-muted-foreground" />
              )}
              <span className="font-medium">Choose a CSV file</span>
              <span className="mt-1 text-sm text-muted-foreground">
                TCGplayer inventory exports are detected automatically. Any other CSV
                works via column mapping. Sealed product is supported.
              </span>
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={handleUpload}
                disabled={busy}
              />
            </label>
          </CardContent>
        </Card>
      ) : null}

      {step === "map" ? (
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>Map columns</CardTitle>
            <Badge variant={preset === "tcgplayer" ? "success" : "secondary"}>
              {preset === "tcgplayer" ? "TCGplayer export detected" : "Generic CSV"}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
              {IMPORT_FIELDS.map((field) => (
                <div key={field} className="flex items-center justify-between gap-3">
                  <span className="text-sm">
                    {FIELD_LABELS[field]}
                    {REQUIRED_FIELDS.includes(field) ? (
                      <span className="text-destructive"> *</span>
                    ) : null}
                  </span>
                  <Select
                    className="w-52"
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
              <h4 className="mb-2 text-sm font-medium text-muted-foreground">
                Preview ({rows.length.toLocaleString()} rows)
              </h4>
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {headers.slice(0, 8).map((h) => (
                        <TableHead key={h}>{h}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.slice(0, 5).map((r, i) => (
                      <TableRow key={i}>
                        {headers.slice(0, 8).map((h) => (
                          <TableCell key={h} className="max-w-40 truncate">
                            {r[h]}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>

            <div className="flex justify-between">
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
          <CardContent className="flex flex-col items-center py-14 text-center">
            <CheckCircle2 className="mb-3 h-10 w-10 text-success" />
            <h3 className="text-lg font-semibold">
              Imported {committedCount.toLocaleString()} inventory line
              {committedCount === 1 ? "" : "s"}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Re-importing the same file updates quantities and prices — it never duplicates.
            </p>
            <div className="mt-5 flex gap-2">
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
    { key: "upload", label: "1. Upload" },
    { key: "map", label: "2. Map columns" },
    { key: "review", label: "3. Review matches" },
    { key: "done", label: "4. Done" },
  ];
  const idx = steps.findIndex((s) => s.key === step);
  return (
    <div className="flex items-center gap-2 text-sm">
      {steps.map((s, i) => (
        <React.Fragment key={s.key}>
          {i > 0 ? <span className="text-muted-foreground">→</span> : null}
          <span
            className={cn(
              "rounded-full px-3 py-1",
              i === idx
                ? "bg-primary text-primary-foreground"
                : i < idx
                  ? "bg-primary/10 text-primary"
                  : "bg-muted text-muted-foreground"
            )}
          >
            {s.label}
          </span>
        </React.Fragment>
      ))}
    </div>
  );
}

function CandidateLabel({ c }: { c: SerializedCandidate }) {
  return (
    <span>
      {c.name}
      {c.number ? ` · #${c.number}` : ""}
      {c.expansionName ? ` · ${c.expansionName}` : ""}
      {c.productType === "sealed" ? " · sealed" : ""}
    </span>
  );
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Review matches</CardTitle>
        <div className="flex flex-wrap gap-2 pt-1">
          <Badge variant="success">{match.matched.length} matched</Badge>
          <Badge variant="warning">{match.ambiguous.length} ambiguous</Badge>
          <Badge variant="destructive">{match.unmatched.length} unmatched</Badge>
          {match.rowErrors.length > 0 ? (
            <Badge variant="outline">{match.rowErrors.length} invalid rows</Badge>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <Tabs defaultValue={match.ambiguous.length > 0 ? "ambiguous" : "matched"}>
          <TabsList>
            <TabsTrigger value="matched">Matched ({match.matched.length})</TabsTrigger>
            <TabsTrigger value="ambiguous">Ambiguous ({match.ambiguous.length})</TabsTrigger>
            <TabsTrigger value="unmatched">Unmatched ({match.unmatched.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="matched">
            <div className="max-h-96 overflow-y-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Import</TableHead>
                    <TableHead>CSV row</TableHead>
                    <TableHead>Matched product</TableHead>
                    <TableHead>Qty</TableHead>
                    <TableHead>Price</TableHead>
                    <TableHead>Via</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {match.matched.map((m) => (
                    <TableRow key={m.row.rowIndex}>
                      <TableCell>
                        <input
                          type="checkbox"
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
                      <TableCell className="max-w-52 truncate">{m.row.productName}</TableCell>
                      <TableCell className="max-w-64 truncate">
                        <CandidateLabel c={m.product} />
                      </TableCell>
                      <TableCell>{m.row.quantity}</TableCell>
                      <TableCell>{formatMoney(m.row.price ?? null)}</TableCell>
                      <TableCell>
                        <Badge variant={m.via === "exact_id" ? "secondary" : "outline"}>
                          {m.via === "exact_id" ? "ID" : "fuzzy"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          <TabsContent value="ambiguous">
            {match.ambiguous.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Nothing ambiguous — nice clean file.
              </p>
            ) : (
              <div className="max-h-96 space-y-3 overflow-y-auto">
                {match.ambiguous.map((a) => (
                  <div key={a.row.rowIndex} className="rounded-md border p-3">
                    <div className="mb-2 flex items-center gap-2 text-sm">
                      <HelpCircle className="h-4 w-4 text-warning" />
                      <span className="font-medium">{a.row.productName}</span>
                      {a.row.setName ? (
                        <span className="text-muted-foreground">({a.row.setName})</span>
                      ) : null}
                      <span className="text-muted-foreground">× {a.row.quantity}</span>
                    </div>
                    <Select
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
                          {c.name}
                          {c.number ? ` · #${c.number}` : ""}
                          {c.expansionName ? ` · ${c.expansionName}` : ""}
                          {c.productType === "sealed" ? " · sealed" : ""}
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
            {match.unmatched.length === 0 && match.rowErrors.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Every row matched.
              </p>
            ) : (
              <div className="space-y-3">
                <div className="max-h-80 overflow-y-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>CSV row</TableHead>
                        <TableHead>Reason</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {match.unmatched.map((u) => (
                        <TableRow key={u.row.rowIndex}>
                          <TableCell className="max-w-56 truncate">
                            {u.row.productName}
                          </TableCell>
                          <TableCell className="text-muted-foreground">{u.reason}</TableCell>
                        </TableRow>
                      ))}
                      {match.rowErrors.map((e) => (
                        <TableRow key={`err-${e.rowIndex}`}>
                          <TableCell>Row {e.rowIndex + 1}</TableCell>
                          <TableCell className="text-muted-foreground">{e.error}</TableCell>
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

        <div className="flex items-center justify-between border-t pt-4">
          <Button variant="ghost" onClick={onBack}>
            Back
          </Button>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">
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
