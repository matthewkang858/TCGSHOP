import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { expansions, games, products } from "@/db/schema";
import { getSessionUser } from "@/lib/tenancy";

/**
 * Generated SVG placeholder art for products without a real image
 * (offline fixture mode, or catalog rows the provider has no image for).
 * Live-synced products carry real TCGplayer image URLs and never hit this.
 */

const PALETTES: Record<number, { bg1: string; bg2: string; accent: string }> = {
  1: { bg1: "#2a2438", bg2: "#4a3f66", accent: "#c9a84c" }, // Magic
  2: { bg1: "#3b2a2a", bg2: "#6b4226", accent: "#d98e32" }, // Yu-Gi-Oh
  3: { bg1: "#1f3a5f", bg2: "#2e5c8f", accent: "#ffcb05" }, // Pokemon
};
const DEFAULT_PALETTE = { bg1: "#2f3640", bg2: "#4b5563", accent: "#9ca3af" };

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function wrap(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if ((line + " " + word).trim().length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = (line + " " + word).trim();
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] = lines[maxLines - 1].slice(0, maxChars - 1) + "…";
  }
  return lines;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ productId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return new NextResponse(null, { status: 401 });

  const parsed = z.coerce.number().int().positive().safeParse((await params).productId);
  if (!parsed.success) return new NextResponse(null, { status: 400 });

  const [product] = await db
    .select({
      name: products.name,
      rarity: products.rarity,
      number: products.number,
      categoryId: products.categoryId,
      productType: products.productType,
      productTypeOverride: products.productTypeOverride,
      setName: expansions.name,
      gameName: games.displayName,
    })
    .from(products)
    .innerJoin(expansions, eq(expansions.groupId, products.groupId))
    .innerJoin(games, eq(games.categoryId, products.categoryId))
    .where(eq(products.productId, parsed.data));
  if (!product) return new NextResponse(null, { status: 404 });

  const palette = PALETTES[product.categoryId] ?? DEFAULT_PALETTE;
  const sealed = (product.productTypeOverride ?? product.productType) === "sealed";
  const nameLines = wrap(product.name, 16, 3);
  const W = 250;
  const H = 350;

  const nameSvg = nameLines
    .map(
      (line, i) =>
        `<text x="${W / 2}" y="${150 + i * 26}" text-anchor="middle" fill="#ffffff" font-size="19" font-weight="600" font-family="ui-sans-serif, system-ui, sans-serif">${esc(line)}</text>`
    )
    .join("");

  // sealed products render as a product box; singles as a card frame
  const art = sealed
    ? `<g transform="translate(${W / 2 - 45}, 48)">
         <path d="M0 18 L45 0 L90 18 L90 66 L45 84 L0 66 Z" fill="${palette.accent}" opacity="0.85"/>
         <path d="M0 18 L45 36 L90 18" stroke="${palette.bg1}" stroke-width="2" fill="none"/>
         <path d="M45 36 L45 84" stroke="${palette.bg1}" stroke-width="2"/>
       </g>`
    : `<rect x="35" y="42" width="${W - 70}" height="70" rx="8" fill="${palette.accent}" opacity="0.25"/>
       <circle cx="${W / 2}" cy="77" r="24" fill="${palette.accent}" opacity="0.7"/>`;

  const footer = sealed
    ? "SEALED PRODUCT"
    : [product.number ? `#${product.number}` : null, product.rarity]
        .filter(Boolean)
        .join(" · ") || "SINGLE";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${palette.bg2}"/>
      <stop offset="100%" stop-color="${palette.bg1}"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" rx="14" fill="url(#bg)"/>
  <rect x="8" y="8" width="${W - 16}" height="${H - 16}" rx="10" fill="none" stroke="${palette.accent}" stroke-width="2" opacity="0.6"/>
  ${art}
  ${nameSvg}
  <text x="${W / 2}" y="${H - 62}" text-anchor="middle" fill="${palette.accent}" font-size="13" font-weight="600" font-family="ui-sans-serif, system-ui, sans-serif">${esc(footer)}</text>
  <text x="${W / 2}" y="${H - 38}" text-anchor="middle" fill="#ffffff" opacity="0.75" font-size="12" font-family="ui-sans-serif, system-ui, sans-serif">${esc(product.setName)}</text>
  <text x="${W / 2}" y="${H - 20}" text-anchor="middle" fill="#ffffff" opacity="0.45" font-size="10" font-family="ui-sans-serif, system-ui, sans-serif">${esc(product.gameName)}</text>
</svg>`;

  return new NextResponse(svg, {
    headers: {
      "content-type": "image/svg+xml",
      "cache-control": "private, max-age=3600",
    },
  });
}
