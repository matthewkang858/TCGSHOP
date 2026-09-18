"use client";

import * as React from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Loader2, MoreHorizontal, Trash2 } from "lucide-react";
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
import { deleteTransactionAction } from "./actions";

/**
 * The ledger's single row control: an overflow trigger, never a bare red icon.
 * Delete lives at the bottom of the menu and still routes through the confirm
 * dialog, because the action does not restore stock.
 */
export function DeleteTransactionButton({ id, label }: { id: string; label: string }) {
  const [busy, setBusy] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <Button
            variant="ghost"
            size="icon"
            type="button"
            aria-label="Entry actions"
            className="text-muted-foreground"
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={4}
            className="z-50 min-w-[172px] rounded-md border border-border bg-card p-1 shadow-float"
          >
            <DropdownMenu.Item
              onSelect={(e) => {
                e.preventDefault();
                setOpen(true);
              }}
              className="flex h-9 cursor-pointer select-none items-center gap-2 rounded-sm px-2 text-sm text-destructive outline-none data-[highlighted]:bg-destructive/10"
            >
              <Trash2 className="size-4" />
              Delete entry
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      <Dialog open={open} onOpenChange={setOpen}>
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
              <Button variant="destructive" type="submit" disabled={busy} className="w-full">
                {busy ? <Loader2 className="animate-spin" /> : null}
                Delete entry
              </Button>
              <input type="hidden" name="transactionId" value={id} />
            </form>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
