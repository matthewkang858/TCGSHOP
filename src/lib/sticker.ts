/**
 * Shelf-sticker pricing helpers.
 *
 * Physical sticker prices are chunkier than marketplace prices: staff don't
 * re-label a booster box over 37 cents. Suggested sticker prices round in
 * tiers ("nearest five" for real money, saner steps below that):
 *   >= $20  -> nearest $5
 *   $5-20   -> nearest $1
 *   <  $5   -> exact cents (cheap singles keep their .49/.99 pricing)
 *
 * An inventory line needs re-stickering when its suggested sticker differs
 * from the last price staff recorded on the shelf (or was never stickered).
 * NOTE: the dashboard's SQL sticker queue mirrors this logic - keep in sync.
 */

export function suggestedStickerPrice(price: number): number {
  if (!Number.isFinite(price) || price <= 0) return 0;
  if (price >= 20) return Math.round(price / 5) * 5;
  if (price >= 5) return Math.round(price);
  return Math.round(price * 100) / 100;
}

export function needsResticker(
  currentPrice: number | null,
  stickerPrice: number | null
): boolean {
  if (currentPrice == null) return false; // nothing to price against
  if (stickerPrice == null) return true; // never stickered
  return suggestedStickerPrice(currentPrice) !== Number(stickerPrice);
}
