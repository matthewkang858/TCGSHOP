/* eslint-disable @next/next/no-img-element */
import { cn } from "@/lib/utils";

/**
 * Product image with generated-placeholder fallback.
 * Real images (live catalog sync) win; otherwise /api/placeholder renders
 * card-style SVG art so the UI is never a wall of gray boxes.
 */
export function ProductImage({
  productId,
  imageUrl,
  name,
  className,
}: {
  productId: number;
  imageUrl?: string | null;
  name: string;
  className?: string;
}) {
  return (
    <img
      src={imageUrl || `/api/placeholder/${productId}`}
      alt={name}
      loading="lazy"
      className={cn("rounded-md border object-cover", className)}
    />
  );
}
