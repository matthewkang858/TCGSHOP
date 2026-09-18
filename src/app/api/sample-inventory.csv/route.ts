import { NextResponse } from "next/server";
import { desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { expansions, games, priceSnapshots, products } from "@/db/schema";
import { getSessionUser } from "@/lib/tenancy";

/**
 * Downloadable sample inventory CSV in TCGplayer export format, built from
 * real catalog rows so importing it round-trips through the wizard cleanly.
 */

const HEADERS = [
  "TCGplayer Id",
  "Product Line",
  "Set Name",
  "Product Name",
  "Number",
  "Rarity",
  "Condition",
  "Total Quantity",
  "TCG Marketplace Price",
];

// cycled across the singles so the sample shows condition variety
const SINGLE_CONDITIONS = [
  "Near Mint",
  "Near Mint",
  "Lightly Played",
  "Near Mint Foil",
  "Moderately Played",
  "Near Mint",
  "Heavily Played",
];

function csvField(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** deterministic plausible price when no snapshot exists */
function fallbackPrice(productId: number, sealed: boolean): number {
  return sealed
    ? ((productId % 8000) + 3999) / 100 // $39.99–$119.98
    : ((productId % 1450) + 49) / 100; // $0.49–$14.98
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) return new NextResponse(null, { status: 401 });

  const productType = sql<
    "single" | "sealed" | "other"
  >`coalesce(${products.productTypeOverride}, ${products.productType})`;

  const pick = (type: "single" | "sealed", limit: number) =>
    db
      .select({
        productId: products.productId,
        name: products.name,
        number: products.number,
        rarity: products.rarity,
        setName: expansions.name,
        gameName: games.displayName,
      })
      .from(products)
      .innerJoin(expansions, eq(expansions.groupId, products.groupId))
      .innerJoin(games, eq(games.categoryId, products.categoryId))
      .where(eq(productType, type))
      .orderBy(products.productId)
      .limit(limit);

  const [singles, sealed] = await Promise.all([pick("single", 13), pick("sealed", 2)]);

  const ids = [...singles, ...sealed].map((p) => p.productId);
  const latestPrice = new Map<number, string>();
  if (ids.length > 0) {
    const snapshots = await db
      .select({
        productId: priceSnapshots.productId,
        price: priceSnapshots.price,
      })
      .from(priceSnapshots)
      .where(inArray(priceSnapshots.productId, ids))
      .orderBy(desc(priceSnapshots.capturedAt));
    for (const s of snapshots) {
      if (!latestPrice.has(s.productId)) latestPrice.set(s.productId, s.price);
    }
  }

  const lines = [HEADERS.join(",")];
  singles.forEach((p, i) => {
    const price = latestPrice.get(p.productId) ?? fallbackPrice(p.productId, false).toFixed(2);
    lines.push(
      [
        p.productId,
        csvField(p.gameName),
        csvField(p.setName),
        csvField(p.name),
        csvField(p.number),
        csvField(p.rarity),
        SINGLE_CONDITIONS[i % SINGLE_CONDITIONS.length],
        (p.productId % 7) + 1,
        Number(price).toFixed(2),
      ].join(",")
    );
  });
  for (const p of sealed) {
    const price = latestPrice.get(p.productId) ?? fallbackPrice(p.productId, true).toFixed(2);
    lines.push(
      [
        p.productId,
        csvField(p.gameName),
        csvField(p.setName),
        csvField(p.name),
        csvField(p.number),
        csvField(p.rarity),
        "Unopened",
        (p.productId % 3) + 1,
        Number(price).toFixed(2),
      ].join(",")
    );
  }

  return new NextResponse(lines.join("\n") + "\n", {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="sample-inventory.csv"',
      "cache-control": "private, max-age=300",
    },
  });
}
