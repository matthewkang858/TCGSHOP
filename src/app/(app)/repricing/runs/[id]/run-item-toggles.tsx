"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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
    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
  ) : (
    <input
      type="checkbox"
      checked={!excluded}
      disabled={disabled}
      title={excluded ? "Excluded from apply" : "Included in apply"}
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
      variant={approved ? "secondary" : "outline"}
      size="sm"
      className="h-7 text-xs"
      disabled={disabled || pending}
      onClick={() =>
        startTransition(async () => {
          await toggleRunItemAction({ runId, itemId, field: "approved", value: !approved });
        })
      }
    >
      {pending ? <Loader2 className="animate-spin" /> : approved ? "Approved ✓" : "Approve"}
    </Button>
  );
}
