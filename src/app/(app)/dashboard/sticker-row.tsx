"use client";

import * as React from "react";
import Link from "next/link";
import { Check, Loader2, PackageX, ShoppingCart } from "lucide-react";
import { ProductImage } from "@/components/product-image";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn, formatMoney } from "@/lib/utils";
import { markNotCarriedAction, markStickerUpdatedAction } from "./actions";

export type StickerQueueItem = {
  id: string;
  productId: number;
  name: string;
  imageUrl: string | null;
  condition: string;
  printing: string | null;
  quantity: number;
  suggested: number;
  stickerPrice: number | null;
};

export function StickerRow({ item }: { item: StickerQueueItem }) {
  const [, startTransition] = React.useTransition();
  // Optimistic pressed state: once set, the row shows a spinner status line
  // until the server action revalidates the dashboard and the row leaves.
  const [status, setStatus] = React.useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  const submit = (action: (formData: FormData) => Promise<void>, label: string) => {
    setStatus(label);
    const formData = new FormData();
    formData.set("itemId", item.id);
    startTransition(() => action(formData));
  };

  const delta = item.stickerPrice !== null ? item.suggested - item.stickerPrice : null;
  const sellHref = `/transactions?productId=${item.productId}&side=sale&condition=${encodeURIComponent(
    item.condition
  )}&printing=${encodeURIComponent(item.printing ?? "")}`;

  if (status) {
    return (
      <div className="flex min-h-14 items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
        <span className="truncate">
          {status} · {item.name}
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 rounded-md border px-3 py-2">
      <ProductImage
        productId={item.productId}
        imageUrl={item.imageUrl}
        name={item.name}
        className="h-14 w-10 shrink-0"
      />
      <div className="min-w-0 flex-1">
        <Link
          href={`/products/${item.productId}`}
          className="block truncate text-sm font-medium text-primary hover:underline"
        >
          {item.name}
        </Link>
        <p className="truncate text-xs text-muted-foreground">
          {item.condition}
          {item.printing ? ` · ${item.printing}` : ""} · {item.quantity} in stock
        </p>
        <p className="text-sm tabular-nums">
          {item.stickerPrice !== null ? (
            <>
              <span className="text-muted-foreground line-through">
                {formatMoney(item.stickerPrice)}
              </span>{" "}
              <span className="font-semibold">→ {formatMoney(item.suggested)}</span>
            </>
          ) : (
            <span className="font-semibold">{formatMoney(item.suggested)}</span>
          )}{" "}
          <span
            className={cn(
              "text-xs",
              delta === null
                ? "text-muted-foreground"
                : delta >= 0
                  ? "text-success"
                  : "text-destructive"
            )}
          >
            {delta === null
              ? "needs first sticker"
              : `${delta >= 0 ? "+" : "−"}${formatMoney(Math.abs(delta))}`}
          </span>
        </p>
      </div>
      <div className="flex shrink-0 flex-col gap-1">
        <Button
          size="sm"
          variant="outline"
          className="h-11 w-full justify-start md:h-8"
          onClick={() => submit(markStickerUpdatedAction, "Saving new sticker")}
        >
          <Check />
          Updated
        </Button>
        <Button asChild size="sm" variant="outline" className="h-11 w-full justify-start md:h-8">
          <Link href={sellHref}>
            <ShoppingCart />
            Sell
          </Link>
        </Button>
        <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <DialogTrigger asChild>
            <Button
              size="sm"
              variant="ghost"
              className="h-11 w-full justify-start text-xs text-muted-foreground md:h-8"
            >
              <PackageX />
              Don&apos;t carry
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Stop carrying this item?</DialogTitle>
              <DialogDescription>
                This removes &ldquo;{item.name}&rdquo; ({item.condition}
                {item.printing ? `, ${item.printing}` : ""}) from your working inventory;
                restocking brings it back.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2">
              <DialogClose asChild>
                <Button variant="outline" className="h-11 sm:h-9">
                  Cancel
                </Button>
              </DialogClose>
              <Button
                variant="destructive"
                className="h-11 sm:h-9"
                onClick={() => {
                  setConfirmOpen(false);
                  submit(markNotCarriedAction, "Removing from inventory");
                }}
              >
                <PackageX />
                Don&apos;t carry
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
