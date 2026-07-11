import { matchesSealedKeyword } from "@/lib/catalog/classifier";
import type { MappedRow } from "./mapping";

/**
 * Catalog matching for imported rows.
 *
 * Strategy (per row):
 *  1. Exact productId when the row carries one and it exists in the catalog.
 *  2. Fuzzy: score candidates by normalized-name similarity (bigram Dice),
 *     with collector number as a strong signal for singles.
 *  3. Sealed rows (no collector number + sealed keywords) only match sealed
 *     candidates, and near-misses go to the ambiguous queue - never guessed.
 *
 * The scorer is pure: callers supply candidate products, so the whole thing
 * unit-tests without a database.
 */

export type CandidateProduct = {
  productId: number;
  name: string;
  cleanName: string;
  number: string | null;
  rarity: string | null;
  groupId: number;
  categoryId: number;
  productType: "single" | "sealed" | "other";
  expansionName?: string | null;
  expansionAbbreviation?: string | null;
};

export type MatchResult =
  | { status: "matched"; row: MappedRow; product: CandidateProduct; via: "exact_id" | "fuzzy" }
  | { status: "ambiguous"; row: MappedRow; candidates: CandidateProduct[] }
  | { status: "unmatched"; row: MappedRow; reason: string };

// --- similarity -------------------------------------------------------------

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[''`]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function bigrams(s: string): Map<string, number> {
  const out = new Map<string, number>();
  const padded = ` ${s} `;
  for (let i = 0; i < padded.length - 1; i++) {
    const bg = padded.slice(i, i + 2);
    out.set(bg, (out.get(bg) ?? 0) + 1);
  }
  return out;
}

/** Sørensen–Dice coefficient over character bigrams (0..1). */
export function nameSimilarity(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (na === nb) return 1;
  if (!na || !nb) return 0;
  const ba = bigrams(na);
  const bb = bigrams(nb);
  let overlap = 0;
  let sizeA = 0;
  let sizeB = 0;
  for (const n of ba.values()) sizeA += n;
  for (const n of bb.values()) sizeB += n;
  for (const [bg, n] of ba) overlap += Math.min(n, bb.get(bg) ?? 0);
  return (2 * overlap) / (sizeA + sizeB);
}

function normalizeNumber(n: string | null | undefined): string | null {
  if (!n) return null;
  // "004/102" -> "4/102", "4" -> "4"
  const [main, of] = n.split("/");
  const stripped = main.replace(/^0+(?=\d)/, "").trim();
  return of ? `${stripped}/${of.trim()}` : stripped;
}

function numbersMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizeNumber(a);
  const nb = normalizeNumber(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // allow "4" vs "4/102"
  return na.split("/")[0] === nb.split("/")[0];
}

// --- matching ----------------------------------------------------------------

export const MATCH_THRESHOLD = 0.82;
export const AMBIGUITY_MARGIN = 0.06;
const CANDIDATE_FLOOR = 0.55;

export function isSealedRow(row: MappedRow): boolean {
  return !row.number && matchesSealedKeyword(row.productName);
}

export function scoreCandidate(row: MappedRow, candidate: CandidateProduct): number {
  let score = nameSimilarity(row.productName, candidate.name);
  // clean_name often strips punctuation the display name keeps
  score = Math.max(score, nameSimilarity(row.productName, candidate.cleanName));

  if (row.number) {
    if (numbersMatch(row.number, candidate.number)) {
      score = Math.min(1, score + 0.15);
    } else if (candidate.number) {
      score -= 0.25; // both have numbers and they disagree - strong negative
    }
  }

  if (row.setName && candidate.expansionName) {
    const setSim = Math.max(
      nameSimilarity(row.setName, candidate.expansionName),
      candidate.expansionAbbreviation
        ? row.setName.toLowerCase() === candidate.expansionAbbreviation.toLowerCase()
          ? 1
          : 0
        : 0
    );
    if (setSim >= 0.9) score = Math.min(1, score + 0.05);
    else if (setSim < 0.4) score -= 0.2;
  }

  return score;
}

/**
 * Match one mapped row against candidate products.
 * `candidates` should already be narrowed (by game/set when resolvable);
 * passing a whole game's products still works, just slower.
 */
export function matchRow(row: MappedRow, candidates: CandidateProduct[]): MatchResult {
  // 1. exact product id
  if (row.productId) {
    const exact = candidates.find((c) => c.productId === row.productId);
    if (exact) return { status: "matched", row, product: exact, via: "exact_id" };
    return {
      status: "unmatched",
      row,
      reason: `Product ID ${row.productId} not found in local catalog (sync the catalog and retry)`,
    };
  }

  // 2. fuzzy
  const sealed = isSealedRow(row);
  const pool = sealed ? candidates.filter((c) => c.productType === "sealed") : candidates;

  const scored = pool
    .map((candidate) => ({ candidate, score: scoreCandidate(row, candidate) }))
    .filter((s) => s.score >= CANDIDATE_FLOOR)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return {
      status: "unmatched",
      row,
      reason: sealed
        ? "No sealed product in the catalog resembles this name"
        : "No catalog product resembles this name",
    };
  }

  const best = scored[0];
  const second = scored[1];

  const decisive =
    best.score >= MATCH_THRESHOLD &&
    (!second || best.score - second.score >= AMBIGUITY_MARGIN || second.score < MATCH_THRESHOLD);

  if (decisive) {
    return { status: "matched", row, product: best.candidate, via: "fuzzy" };
  }

  // near-misses go to the ambiguous queue rather than guessing
  return {
    status: "ambiguous",
    row,
    candidates: scored.slice(0, 5).map((s) => s.candidate),
  };
}
