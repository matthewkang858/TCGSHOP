"use client";

import * as React from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { toggleRuleActiveAction } from "./actions";
import { ConfirmButton } from "./confirm-button";

const menuItemClass =
  "flex h-9 w-full cursor-pointer select-none items-center rounded-sm px-2 text-sm font-normal outline-none focus:bg-muted data-[highlighted]:bg-muted";

/** Active/inactive is a switch, not a badge — same server action as before. */
export function RuleActiveSwitch({
  ruleId,
  active,
  name,
}: {
  ruleId: string;
  active: boolean;
  name: string;
}) {
  const [pending, startTransition] = React.useTransition();
  const [checked, setChecked] = React.useState(active);

  // The server is the source of truth; re-sync after a revalidate.
  React.useEffect(() => setChecked(active), [active]);

  return (
    <Switch
      checked={checked}
      disabled={pending}
      aria-label={`${checked ? "Disable" : "Enable"} ${name}`}
      onCheckedChange={(next) => {
        setChecked(next);
        const formData = new FormData();
        formData.set("ruleId", ruleId);
        formData.set("active", next ? "true" : "false");
        startTransition(async () => {
          await toggleRuleActiveAction(formData);
        });
      }}
    />
  );
}

/**
 * Row overflow. The destructive item submits the per-rule form rendered
 * outside the run form (via form="delete-rule-<id>"), because nesting a form
 * inside the run form would be invalid HTML.
 */
export function RuleOverflowMenu({ ruleId, name }: { ruleId: string; name: string }) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button
          size="icon"
          variant="ghost"
          title="More actions"
          aria-label={`More actions for ${name}`}
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
            <ConfirmButton
              type="submit"
              form={`delete-rule-${ruleId}`}
              variant="ghost"
              className={cn(menuItemClass, "justify-start text-destructive hover:text-destructive")}
              message={`Delete rule "${name}"? This can't be undone.`}
            >
              Delete rule
            </ConfirmButton>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
