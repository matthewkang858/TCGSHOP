"use client";

import * as React from "react";
import Link from "next/link";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, Loader2, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn, formatMoney } from "@/lib/utils";
import { markNotCarriedAction, markStickerUpdatedAction } from "./actions";
import { Row, RowActions, RowBody, RowMeta, RowRail, RowThumb, RowTitle } from "./ui";

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

const menuItemClass =
  "flex h-9 cursor-pointer select-none items-center rounded-sm px-2 text-sm outline-none focus:bg-muted data-[highlighted]:bg-muted";

export function StickerRow({
  item,
  className,
}: {
  item: StickerQueueItem;
  className?: string;
}) {
  const [, startTransition] = React.useTransition();
  // Optimistic pressed state: once set, the row keeps its place and height and
  // shows a spinner until the server action revalidates and the row leaves.
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
  const meta = [
    item.condition,
    item.printing ? item.printing : null,
    `${item.quantity} in stock`,
  ]
    .filter(Boolean)
    .join(" · ");

  if (status) {
    return (
      <Row className={cn("bg-muted/30", className)}>
        <RowThumb productId={item.productId} imageUrl={item.imageUrl} name={item.name} />
        <RowBody>
          <RowTitle title={item.name}>{item.name}</RowTitle>
          <RowMeta>{status}…</RowMeta>
        </RowBody>
        <RowRail>
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </RowRail>
      </Row>
    );
  }

  return (
    <Row className={className}>
      <RowThumb productId={item.productId} imageUrl={item.imageUrl} name={item.name} />
      <RowBody>
        <RowTitle href={`/products/${item.productId}`} title={item.name}>
          {item.name}
        </RowTitle>
        <RowMeta>
          {meta}
          {item.stickerPrice !== null ? (
            <>
              {" · was "}
              <span className="tabular-nums line-through">
                {formatMoney(item.stickerPrice)}
              </span>
            </>
          ) : null}
        </RowMeta>
      </RowBody>
      <RowRail>
        <span className="text-sm font-medium tabular-nums text-foreground">
          {formatMoney(item.suggested)}
        </span>
        <span
          className={cn(
            "text-xs font-medium tabular-nums",
            delta === null
              ? "text-muted-foreground"
              : delta >= 0
                ? "text-success"
                : "text-destructive"
          )}
        >
          {delta === null
            ? "first sticker"
            : `${delta >= 0 ? "+" : "−"}${formatMoney(Math.abs(delta))}`}
        </span>
      </RowRail>
      <RowActions className="w-[76px] md:w-[124px]">
        <Button
          size="sm"
          variant="outline"
          className="w-9 px-0 md:w-auto md:px-2.5"
          title="Mark sticker updated"
          aria-label={`Mark sticker updated for ${item.name}`}
          onClick={() => submit(markStickerUpdatedAction, "Saving new sticker")}
        >
          <Check className="md:hidden" />
          <span className="hidden md:inline">Mark updated</span>
        </Button>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <Button
              size="icon"
              variant="ghost"
              title="More actions"
              aria-label={`More actions for ${item.name}`}
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={4}
              className="z-50 min-w-[176px] rounded-md border border-border/60 bg-popover p-1 text-popover-foreground shadow-float"
            >
              <DropdownMenu.Item asChild>
                <Link href={sellHref} className={menuItemClass}>
                  Sell
                </Link>
              </DropdownMenu.Item>
              <DropdownMenu.Separator className="my-1 h-px bg-border" />
              <DropdownMenu.Item
                className={cn(menuItemClass, "text-destructive")}
                onSelect={(event) => {
                  event.preventDefault();
                  setConfirmOpen(true);
                }}
              >
                Don&apos;t carry
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </RowActions>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
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
              <Button variant="outline" size="lg" className="md:h-9 md:px-3.5">
                Cancel
              </Button>
            </DialogClose>
            <Button
              variant="destructive"
              size="lg"
              className="md:h-9 md:px-3.5"
              onClick={() => {
                setConfirmOpen(false);
                submit(markNotCarriedAction, "Removing from inventory");
              }}
            >
              Don&apos;t carry
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Row>
  );
}
