"use client";

import * as React from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { MoreHorizontal } from "lucide-react";
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
import { deleteAlertAction, toggleAlertAction } from "./actions";

const itemClass =
  "flex h-9 w-full cursor-pointer items-center px-3 text-sm text-foreground outline-none data-[highlighted]:bg-muted";

/**
 * The single overflow trigger for an alert row. Pause/resume and delete both
 * live here so the row shows one control instead of three, and delete always
 * routes through the confirm dialog rather than sitting in the row as red text.
 */
export function AlertRowActions({
  alertId,
  alertName,
  active,
}: {
  alertId: string;
  alertName: string;
  active: boolean;
}) {
  const [confirming, setConfirming] = React.useState(false);
  const toggleRef = React.useRef<HTMLFormElement>(null);

  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Actions for ${alertName}`}
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={4}
            className="z-50 min-w-44 overflow-hidden rounded-md border border-border bg-popover py-1 shadow-float"
          >
            <DropdownMenu.Item
              className={itemClass}
              onSelect={() => toggleRef.current?.requestSubmit()}
            >
              {active ? "Pause alert" : "Resume alert"}
            </DropdownMenu.Item>
            <DropdownMenu.Separator className="my-1 h-px bg-border/60" />
            <DropdownMenu.Item
              className={`${itemClass} text-destructive`}
              onSelect={() => setConfirming(true)}
            >
              Delete alert
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      <form action={toggleAlertAction} ref={toggleRef} className="hidden">
        <input type="hidden" name="alertId" value={alertId} />
        <input type="hidden" name="active" value={active ? "false" : "true"} />
      </form>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this alert?</DialogTitle>
            <DialogDescription>
              “{alertName}” stops evaluating immediately. Events it already fired stay in the
              feed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <form action={deleteAlertAction}>
              <input type="hidden" name="alertId" value={alertId} />
              <Button type="submit" variant="destructive">
                Delete alert
              </Button>
            </form>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
