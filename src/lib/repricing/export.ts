/**
 * Configurable column-mapping CSV exporter for applied reprice runs.
 * A mapping is { "CSV Header": "field_token" } - stored per store in
 * settings.export_mappings and editable in Settings, because marketplace
 * export formats drift. The TCGplayer preset ships as the default.
 */

export const EXPORT_FIELDS = [
  "tcgplayer_id",
  "product_name",
  "set_name",
  "condition",
  "printing",
  "language",
  "quantity",
  "new_price",
  "old_price",
] as const;

export type ExportField = (typeof EXPORT_FIELDS)[number];

export type ExportRow = Record<ExportField, string | number | null>;

/** header -> field token. Insertion order = column order. */
export type ExportMapping = Record<string, string>;

export const TCGPLAYER_EXPORT_PRESET: ExportMapping = {
  "TCGplayer Id": "tcgplayer_id",
  "Product Name": "product_name",
  "Set Name": "set_name",
  Condition: "condition",
  Printing: "printing",
  Quantity: "quantity",
  "Marketplace Price": "new_price",
};

function csvEscape(value: string | number | null): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function buildExportCsv(rows: ExportRow[], mapping: ExportMapping): string {
  const headers = Object.keys(mapping);
  const lines = [headers.map(csvEscape).join(",")];
  for (const row of rows) {
    lines.push(
      headers
        .map((h) => {
          const field = mapping[h] as ExportField;
          return csvEscape(row[field] ?? null);
        })
        .join(",")
    );
  }
  return lines.join("\r\n") + "\r\n";
}
