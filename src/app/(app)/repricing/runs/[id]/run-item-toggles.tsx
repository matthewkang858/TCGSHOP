"use client";

import * as React from "react";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toggleRunItemAction } from "../../actions";

export function ExcludeToggle({
  runId,
  itemId,
  excluded,
  disabled,
}: {
  runId: string;
  itemId: string;
  excluded: boolean;
  disabled?: boolean;
}) {
  const [pending, startTransition] = React.useTransition();
  return pending ? (
    <Loader2 className="size-4 animate-spin text-muted-foreground" />
  ) : (
    <input
      type="checkbox"
      checked={!excluded}
      disabled={disabled}
      aria-label={excluded ? "Include in apply" : "Exclude from apply"}
      title={excluded ? "Excluded from apply" : "Included in apply"}
      className="size-4 accent-primary disabled:opacity-40"
      onChange={(e) =>
        startTransition(async () => {
          await toggleRunItemAction({
            runId,
            itemId,
            field: "excluded",
            value: !e.target.checked,
          });
        })
      }
    />
  );
}

export function ApproveButton({
  runId,
  itemId,
  approved,
  disabled,
}: {
  runId: string;
  itemId: string;
  approved: boolean;
  disabled?: boolean;
}) {
  const [pending, startTransition] = React.useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      className={cn(approved && "text-muted-foreground")}
      disabled={disabled || pending}
      aria-label={approved ? "Approved — undo" : "Approve this flagged change"}
      onClick={() =>
        startTransition(async () => {
          await toggleRunItemAction({ runId, itemId, field: "approved", value: !approved });
        })
      }
    >
      {pending ? (
        <Loader2 className="animate-spin" />
      ) : approved ? (
        <>
          <Check />
          Approved
        </>
      ) : (
        "Approve"
      )}
    </Button>
  );
}
