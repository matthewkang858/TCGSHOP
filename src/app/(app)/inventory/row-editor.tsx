"use client";

import * as React from "react";
import Link from "next/link";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, Loader2, MoreHorizontal, Pencil, ShoppingCart, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TableCell, TableRow } from "@/components/ui/table";
import { ProductImage } from "@/components/product-image";
import { cn, formatMoney } from "@/lib/utils";
import { deleteInventoryItemAction, updateInventoryItemAction } from "./actions";

export type EditableItem = {
  id: string;
  quantity: number;
  currentPrice: string | null;
  costBasis: string | null;
  tags: string[];
};

export type InventoryRowItem = {
  id: string;
  productId: number;
  productName: string;
  imageUrl: string | null;
  expansionName: string;
  productType: "single" | "sealed" | "other";
  condition: string;
  printing: string | null;
  quantity: number;
  currentPrice: string | null;
  costBasis: string | null;
};

/**
 * Inline qty/price/cost editing for one line. Tags are deliberately not edited
 * here any more (storage tags live on the product page), and the update action
 * leaves them untouched when the field is omitted.
 */
function useRowEditor(item: InventoryRowItem) {
  const [editing, setEditing] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);
  const [qty, setQty] = React.useState(String(item.quantity));
  const [price, setPrice] = React.useState(item.currentPrice ?? "");
  const [cost, setCost] = React.useState(item.costBasis ?? "");

  function cancel() {
    setQty(String(item.quantity));
    setPrice(item.currentPrice ?? "");
    setCost(item.costBasis ?? "");
    setEditing(false);
  }

  async function save() {
    setBusy(true);
    try {
      await updateInventoryItemAction({
        id: item.id,
        quantity: qty,
        currentPrice: price === "" ? "" : price,
        costBasis: cost === "" ? "" : cost,
      });
      setEditing(false);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await deleteInventoryItemAction({ id: item.id });
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  return {
    editing,
    setEditing,
    busy,
    confirming,
    setConfirming,
    qty,
    setQty,
    price,
    setPrice,
    cost,
    setCost,
    cancel,
    save,
    remove,
  };
}

function metaLine(parts: (string | null | undefined)[]) {
  return parts.filter(Boolean).join(" · ");
}

function Money({ value, className }: { value: string | null; className?: string }) {
  if (value === null || value === "") {
    return <span className="text-muted-foreground">—</span>;
  }
  return <span className={className}>{formatMoney(value)}</span>;
}

/** Identity cell / list-row body: thumbnail, name (+ the one exception badge), meta line. */
function Identity({
  item,
  meta,
  thumb,
  linkOverlay = false,
}: {
  item: InventoryRowItem;
  meta: string;
  thumb: string;
  linkOverlay?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <div className="flex w-8 shrink-0 justify-center">
        <ProductImage
          productId={item.productId}
          imageUrl={item.imageUrl}
          name={item.productName}
          className={cn("shrink-0 rounded-[3px] border-border/70 bg-muted", thumb)}
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center">
          <Link
            href={`/products/${item.productId}`}
            title={item.productName}
            className={cn(
              "truncate text-sm font-medium text-foreground hover:underline",
              linkOverlay && "after:absolute after:inset-0"
            )}
          >
            {item.productName}
          </Link>
          {item.productType === "sealed" ? (
            <Badge variant="neutral" className="ml-2 shrink-0">
              sealed
            </Badge>
          ) : null}
        </div>
        <p className="truncate text-xs text-muted-foreground" title={meta}>
          {meta}
        </p>
      </div>
    </div>
  );
}

function MenuItemClass(destructive?: boolean) {
  return cn(
    "flex h-9 cursor-pointer select-none items-center gap-2 rounded-sm px-2 text-sm outline-none [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground",
    destructive
      ? "text-destructive data-[highlighted]:bg-destructive/10 [&_svg]:text-destructive"
      : "text-foreground data-[highlighted]:bg-muted"
  );
}

/** Secondary row actions. Destructive lives at the bottom, behind a confirm dialog. */
function RowMenu({
  item,
  sellHref,
  onEdit,
  onDelete,
  withEdit,
}: {
  item: InventoryRowItem;
  sellHref: string;
  onEdit: () => void;
  onDelete: () => void;
  withEdit?: boolean;
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative z-10 shrink-0"
          aria-label={`More actions for ${item.productName}`}
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          className="z-50 min-w-44 rounded-md border border-border bg-card p-1 shadow-float"
        >
          {withEdit ? (
            <DropdownMenu.Item className={MenuItemClass()} onSelect={onEdit}>
              <Pencil />
              Edit line
            </DropdownMenu.Item>
          ) : null}
          <DropdownMenu.Item asChild className={MenuItemClass()}>
            <Link href={sellHref}>
              <ShoppingCart />
              Sell
            </Link>
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.Item
            className={MenuItemClass(true)}
            onSelect={(e) => {
              e.preventDefault();
              onDelete();
            }}
          >
            <Trash2 />
            Delete line
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function ConfirmDelete({
  item,
  open,
  onOpenChange,
  onConfirm,
  busy,
}: {
  item: InventoryRowItem;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConfirm: () => void;
  busy: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete this inventory line?</DialogTitle>
          <DialogDescription>
            {item.productName} · {item.condition} · {item.quantity} in stock. This removes the
            line from inventory; past transactions are untouched.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : null}
            Delete line
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Desktop table row: 5 data columns + one reserved action cell. */
export function InventoryRow({ item, sellHref }: { item: InventoryRowItem; sellHref: string }) {
  const e = useRowEditor(item);
  const meta = metaLine([item.expansionName, item.printing === "Foil" ? "Foil" : null]);

  return (
    <TableRow className="group">
      <TableCell>
        <Identity item={item} meta={meta} thumb="h-10 w-[29px]" />
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        <span className="block truncate" title={item.condition}>
          {item.condition}
        </span>
      </TableCell>
      {e.editing ? (
        <>
          <TableCell className="text-right">
            <Input
              className="h-8 w-full px-2 text-right"
              value={e.qty}
              onChange={(ev) => e.setQty(ev.target.value)}
              inputMode="numeric"
              aria-label="Quantity"
            />
          </TableCell>
          <TableCell className="text-right">
            <Input
              className="h-8 w-full px-2 text-right"
              value={e.price}
              onChange={(ev) => e.setPrice(ev.target.value)}
              inputMode="decimal"
              placeholder="price"
              aria-label="Price"
            />
          </TableCell>
          <TableCell className="text-right">
            <Input
              className="h-8 w-full px-2 text-right"
              value={e.cost}
              onChange={(ev) => e.setCost(ev.target.value)}
              inputMode="decimal"
              placeholder="cost"
              aria-label="Cost basis"
            />
          </TableCell>
          <TableCell className="pl-0">
            <div className="flex items-center justify-end gap-1">
              <Button size="icon" onClick={e.save} disabled={e.busy} aria-label="Save changes">
                {e.busy ? <Loader2 className="animate-spin" /> : <Check />}
              </Button>
              <Button variant="ghost" size="icon" onClick={e.cancel} aria-label="Cancel editing">
                <X />
              </Button>
            </div>
          </TableCell>
        </>
      ) : (
        <>
          <TableCell className="text-right text-sm font-medium tabular-nums text-foreground">
            {item.quantity}
          </TableCell>
          <TableCell className="text-right text-sm font-medium tabular-nums text-foreground">
            <Money value={item.currentPrice} />
          </TableCell>
          <TableCell className="text-right text-sm tabular-nums text-foreground">
            <Money value={item.costBasis} />
          </TableCell>
          <TableCell className="pl-0">
            {/* Slot width is reserved in both states so rows never reflow on hover. */}
            <div className="flex items-center justify-end gap-1 opacity-100 md:has-[[data-state=open]]:opacity-100">
              <Button variant="outline" size="sm" onClick={() => e.setEditing(true)}>
                Edit
              </Button>
              <RowMenu
                item={item}
                sellHref={sellHref}
                onEdit={() => e.setEditing(true)}
                onDelete={() => e.setConfirming(true)}
              />
            </div>
            {/* Radix portals the dialog out of the table, so it can live in the cell. */}
            <ConfirmDelete
              item={item}
              open={e.confirming}
              onOpenChange={e.setConfirming}
              onConfirm={e.remove}
              busy={e.busy}
            />
          </TableCell>
        </>
      )}
    </TableRow>
  );
}

/** Phone list row: same 64px rhythm as every other list in the product. */
export function InventoryListRow({
  item,
  sellHref,
}: {
  item: InventoryRowItem;
  sellHref: string;
}) {
  const e = useRowEditor(item);
  const meta = metaLine([
    item.expansionName,
    item.condition,
    item.printing === "Foil" ? "Foil" : null,
    `${item.quantity} in stock`,
  ]);

  if (e.editing) {
    return (
      <div className="border-b border-border/60 px-4 py-3 last:border-0">
        <p className="truncate text-sm font-medium text-foreground">{item.productName}</p>
        <div className="mt-2 grid grid-cols-3 gap-2">
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
              Qty
            </span>
            <Input
              className="text-right"
              value={e.qty}
              onChange={(ev) => e.setQty(ev.target.value)}
              inputMode="numeric"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
              Price
            </span>
            <Input
              className="text-right"
              value={e.price}
              onChange={(ev) => e.setPrice(ev.target.value)}
              inputMode="decimal"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
              Cost
            </span>
            <Input
              className="text-right"
              value={e.cost}
              onChange={(ev) => e.setCost(ev.target.value)}
              inputMode="decimal"
            />
          </label>
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="outline" onClick={e.cancel} disabled={e.busy}>
            Cancel
          </Button>
          <Button onClick={e.save} disabled={e.busy}>
            {e.busy ? <Loader2 className="animate-spin" /> : null}
            Save
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="group relative flex h-16 items-center gap-3 border-b border-border/60 px-4 transition-colors last:border-0 hover:bg-muted/40">
      <Identity item={item} meta={meta} thumb="h-11 w-8" linkOverlay />
      <div className="min-w-[88px] shrink-0 text-right tabular-nums">
        <p className="text-sm font-medium text-foreground">
          <Money value={item.currentPrice} />
        </p>
        <p className="text-xs text-muted-foreground">
          {item.costBasis ? `cost ${formatMoney(item.costBasis)}` : "cost —"}
        </p>
      </div>
      <div className="flex w-9 shrink-0 justify-end">
        <RowMenu
          item={item}
          sellHref={sellHref}
          withEdit
          onEdit={() => e.setEditing(true)}
          onDelete={() => e.setConfirming(true)}
        />
      </div>
      <ConfirmDelete
        item={item}
        open={e.confirming}
        onOpenChange={e.setConfirming}
        onConfirm={e.remove}
        busy={e.busy}
      />
    </div>
  );
}
