import { BrandMark } from "@/components/ui/logo";

/**
 * Shared backdrop + branding for /login and /login/check-email.
 */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-accent via-background to-background p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <BrandMark className="h-12 w-12 text-xl" />
          <h1 className="mt-3 text-2xl font-semibold tracking-tight">Countertop</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Repricing, shelf stickers, and a live counter ledger for card stores
          </p>
        </div>
        {children}
      </div>
    </div>
  );
}
