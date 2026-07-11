"use client";

/* eslint-disable @next/next/no-img-element */
import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Product image with generated-placeholder fallback.
 * Real images (live catalog sync, or the demo's Base Set scans) win; if the
 * URL is missing or fails to load, /api/placeholder renders card-style SVG
 * art so the UI is never a wall of broken images.
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
  const placeholder = `/api/placeholder/${productId}`;
  const [src, setSrc] = React.useState(imageUrl || placeholder);
  return (
    <img
      src={src}
      alt={name}
      loading="lazy"
      onError={() => {
        if (src !== placeholder) setSrc(placeholder);
      }}
      className={cn("rounded-md border object-cover", className)}
    />
  );
}
