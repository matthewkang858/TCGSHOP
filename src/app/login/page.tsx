import { redirect } from "next/navigation";
import { Sparkles } from "lucide-react";
import { z } from "zod";
import { signIn } from "@/auth";
import { env } from "@/lib/env";
import { getSessionUser } from "@/lib/tenancy";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AuthShell } from "./auth-shell";
import { demoLoginAction } from "./demo-login";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getSessionUser();
  if (user) redirect("/");
  const { error } = z
    .object({ error: z.string().max(200).optional() })
    .parse(await searchParams);

  async function loginAction(formData: FormData) {
    "use server";
    const email = z.string().email().parse(formData.get("email"));
    await signIn("email", { email, redirectTo: "/" });
  }

  return (
    <AuthShell>
      <Card>
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <span className="text-xs text-muted-foreground">Magic link · no password</span>
        </CardHeader>
        <CardContent className="space-y-4">
          {error ? (
            <p className="rounded-md border border-destructive/25 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          ) : null}

          {env.DEMO_LOGIN ? (
            <>
              <form action={demoLoginAction}>
                <Button type="submit" className="w-full" size="lg">
                  <Sparkles />
                  View the demo store
                </Button>
              </form>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <div className="h-px flex-1 bg-border" />
                or sign in with email
                <div className="h-px flex-1 bg-border" />
              </div>
            </>
          ) : null}

          <form action={loginAction} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                placeholder="you@yourstore.com"
                required
              />
            </div>
            <Button
              type="submit"
              size="lg"
              variant={env.DEMO_LOGIN ? "outline" : "default"}
              className="w-full"
            >
              Send magic link
            </Button>
            {!env.RESEND_API_KEY ? (
              <p className="text-xs text-muted-foreground">
                Demo mode: the sign-in link prints to the server console.
              </p>
            ) : null}
          </form>
        </CardContent>
      </Card>
    </AuthShell>
  );
}
