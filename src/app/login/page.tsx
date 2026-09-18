import { redirect } from "next/navigation";
import { signIn } from "@/auth";
import { getSessionUser } from "@/lib/tenancy";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AuthShell } from "./auth-shell";
import { z } from "zod";

export default async function LoginPage() {
  const user = await getSessionUser();
  if (user) redirect("/");

  async function loginAction(formData: FormData) {
    "use server";
    const email = z.string().email().parse(formData.get("email"));
    await signIn("email", { email, redirectTo: "/" });
  }

  return (
    <AuthShell>
      <Card className="shadow-float">
        <CardHeader className="text-center">
          <CardTitle className="text-xl">Sign in</CardTitle>
          <CardDescription>
            We&apos;ll email you a magic link. No password needed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={loginAction} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                placeholder="you@yourstore.com"
                required
              />
            </div>
            <Button type="submit" className="w-full">
              Send magic link
            </Button>
            <p className="rounded-md border border-border/60 bg-muted/50 px-3 py-2 text-center text-xs text-muted-foreground">
              Demo mode: the sign-in link prints to the server console.
            </p>
          </form>
        </CardContent>
      </Card>
    </AuthShell>
  );
}
