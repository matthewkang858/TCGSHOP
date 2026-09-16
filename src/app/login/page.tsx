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
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-lg font-bold text-primary-foreground">
            C
          </div>
          <CardTitle className="text-xl">Countertop</CardTitle>
          <CardDescription>
            Repricing &amp; price alerts for your game store. Sign in with a
            magic link.
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
            <p className="text-center text-xs text-muted-foreground">
              No email configured? The link is printed to the server console.
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
