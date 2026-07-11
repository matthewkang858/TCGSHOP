import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  expansions,
  inventoryItems,
  products,
  repriceRunItems,
  repriceRuns,
} from "@/db/schema";
import { getStoreContext } from "@/lib/tenancy";
import {
  buildExportCsv,
  TCGPLAYER_EXPORT_PRESET,
  type ExportRow,
} from "@/lib/repricing/export";

/**
 * CSV download of a reprice run, using the store's configurable column
 * mapping (Settings -> Export mapping; TCGplayer preset by default).
 * Only rows that were / would be applied are exported.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getStoreContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = z.string().uuid().safeParse((await params).id);
  if (!parsed.success) return NextResponse.json({ error: "Bad run id" }, { status: 400 });
  const runId = parsed.data;

  const [run] = await db
    .select()
    .from(repriceRuns)
    .where(and(eq(repriceRuns.id, runId), eq(repriceRuns.storeId, ctx.storeId)));
  if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const rows = await db
    .select({
      excluded: repriceRunItems.excluded,
      flagged: repriceRunItems.flagged,
      approved: repriceRunItems.approved,
      newPrice: repriceRunItems.newPrice,
      oldPrice: repriceRunItems.oldPrice,
      productId: products.productId,
      productName: products.name,
      setName: expansions.name,
      condition: inventoryItems.condition,
      printing: inventoryItems.printing,
      language: inventoryItems.language,
      quantity: inventoryItems.quantity,
    })
    .from(repriceRunItems)
    .innerJoin(inventoryItems, eq(inventoryItems.id, repriceRunItems.inventoryItemId))
    .innerJoin(products, eq(products.productId, inventoryItems.productId))
    .innerJoin(expansions, eq(expansions.groupId, products.groupId))
    .where(eq(repriceRunItems.runId, runId))
    .orderBy(asc(products.cleanName));

  const exportRows: ExportRow[] = rows
    .filter((r) => !r.excluded && r.newPrice !== null && (!r.flagged || r.approved))
    .map((r) => ({
      tcgplayer_id: r.productId,
      product_name: r.productName,
      set_name: r.setName,
      condition: r.condition,
      printing: r.printing ?? "",
      language: r.language,
      quantity: r.quantity,
      new_price: r.newPrice,
      old_price: r.oldPrice,
    }));

  const mapping = ctx.settings.export_mappings?.tcgplayer ?? TCGPLAYER_EXPORT_PRESET;
  const csv = buildExportCsv(exportRows, mapping);

  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="countertop-reprice-${runId.slice(0, 8)}.csv"`,
    },
  });
}
