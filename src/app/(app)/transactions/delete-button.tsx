"use client";

import * as React from "react";
import { Loader2, Trash2 } from "lucide-react";
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
import { deleteTransactionAction } from "./actions";

export function DeleteTransactionButton({ id, label }: { id: string; label: string }) {
  const [busy, setBusy] = React.useState(false);
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground"
          type="button"
          title="Delete entry (does not restore stock)"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete this ledger entry?</DialogTitle>
          <DialogDescription>
            {label} will be removed from the ledger. Inventory is not restored — if this
            entry adjusted stock, fix the quantity on the inventory page.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <DialogClose asChild>
            <Button variant="outline" type="button">
              Cancel
            </Button>
          </DialogClose>
          <form action={deleteTransactionAction} onSubmit={() => setBusy(true)}>
            <input type="hidden" name="transactionId" value={id} />
            <Button variant="destructive" type="submit" disabled={busy} className="w-full">
              {busy ? <Loader2 className="animate-spin" /> : null}
              Delete entry
            </Button>
          </form>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
