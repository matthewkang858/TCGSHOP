"use client";

import * as React from "react";
import { Button, type ButtonProps } from "@/components/ui/button";

/**
 * Submit button that asks for confirmation first. Accepts the native `form`
 * attribute so it can target a form rendered elsewhere in the tree (needed
 * where nesting the form itself would produce invalid HTML).
 */
export function ConfirmButton({
  message,
  onClick,
  ...props
}: ButtonProps & { message: string }) {
  return (
    <Button
      {...props}
      onClick={(e) => {
        if (!window.confirm(message)) {
          e.preventDefault();
          return;
        }
        onClick?.(e);
      }}
    />
  );
}
