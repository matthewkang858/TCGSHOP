import { BrandMark } from "@/components/ui/logo";

/**
 * Shared backdrop + branding for /login and /login/check-email.
 */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2.5">
          <BrandMark className="h-8 w-8 text-sm" />
          <div className="min-w-0">
            <p className="text-sm font-semibold tracking-[-0.01em] text-foreground">
              Countertop
            </p>
            <p className="text-xs text-muted-foreground">
              Repricing · shelf stickers · counter ledger
            </p>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
