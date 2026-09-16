"use client";

import * as React from "react";
import { Check, Loader2, Pencil, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { deleteInventoryItemAction, updateInventoryItemAction } from "./actions";
import { formatMoney } from "@/lib/utils";

export type EditableItem = {
  id: string;
  quantity: number;
  currentPrice: string | null;
  costBasis: string | null;
  tags: string[];
};

/** Inline qty/price/cost/tags editor for one inventory row. */
export function RowEditor({ item }: { item: EditableItem }) {
  const [editing, setEditing] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [qty, setQty] = React.useState(String(item.quantity));
  const [price, setPrice] = React.useState(item.currentPrice ?? "");
  const [cost, setCost] = React.useState(item.costBasis ?? "");
  const [tags, setTags] = React.useState(item.tags.join(", "));

  async function save() {
    setBusy(true);
    try {
      await updateInventoryItemAction({
        id: item.id,
        quantity: qty,
        currentPrice: price === "" ? "" : price,
        costBasis: cost === "" ? "" : cost,
        tags,
      });
      setEditing(false);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm("Remove this inventory line?")) return;
    setBusy(true);
    try {
      await deleteInventoryItemAction({ id: item.id });
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <div className="flex items-center justify-end gap-4">
        <span className="w-10 text-right tabular-nums">{item.quantity}</span>
        <span className="w-20 text-right tabular-nums">{formatMoney(item.currentPrice)}</span>
        <span className="w-20 text-right tabular-nums text-muted-foreground">
          {formatMoney(item.costBasis)}
        </span>
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" onClick={() => setEditing(true)} title="Edit">
            <Pencil />
          </Button>
          <Button variant="ghost" size="icon" onClick={remove} disabled={busy} title="Delete">
            {busy ? <Loader2 className="animate-spin" /> : <Trash2 />}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-end gap-2">
      <Input
        className="h-8 w-16 text-right"
        value={qty}
        onChange={(e) => setQty(e.target.value)}
        inputMode="numeric"
        title="Quantity"
      />
      <Input
        className="h-8 w-20 text-right"
        value={price}
        onChange={(e) => setPrice(e.target.value)}
        inputMode="decimal"
        placeholder="price"
        title="Price"
      />
      <Input
        className="h-8 w-20 text-right"
        value={cost}
        onChange={(e) => setCost(e.target.value)}
        inputMode="decimal"
        placeholder="cost"
        title="Cost basis"
      />
      <Input
        className="h-8 w-32"
        value={tags}
        onChange={(e) => setTags(e.target.value)}
        placeholder="tags, comma sep"
        title="Tags"
      />
      <Button size="icon" className="h-8 w-8" onClick={save} disabled={busy} title="Save">
        {busy ? <Loader2 className="animate-spin" /> : <Check />}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        onClick={() => setEditing(false)}
        title="Cancel"
      >
        <X />
      </Button>
    </div>
  );
}
