import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { memberships, stores } from "@/db/schema";
import { getStoreContext, requireUser } from "@/lib/tenancy";
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

const onboardingSchema = z.object({
  name: z.string().trim().min(1).max(120),
  discordWebhook: z
    .string()
    .trim()
    .url()
    .startsWith("https://discord.com/api/webhooks/")
    .optional()
    .or(z.literal("")),
});

export default async function OnboardingPage() {
  await requireUser();
  const existing = await getStoreContext();
  if (existing) redirect("/dashboard");

  async function createStoreAction(formData: FormData) {
    "use server";
    const user = await requireUser();
    const parsed = onboardingSchema.parse({
      name: formData.get("name"),
      discordWebhook: formData.get("discordWebhook") ?? "",
    });

    const [store] = await db
      .insert(stores)
      .values({
        name: parsed.name,
        settings: {
          ...(parsed.discordWebhook
            ? { discord_webhook_url: parsed.discordWebhook }
            : {}),
          default_rounding: "psychological",
          email_alerts: true,
        },
      })
      .returning();

    await db.insert(memberships).values({
      userId: user.id,
      storeId: store.id,
      role: "owner",
    });

    redirect("/dashboard");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Set up your store</CardTitle>
          <CardDescription>
            Your store is your workspace — inventory, pricing rules, and alerts
            all live here. You can invite teammates later in Settings.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={createStoreAction} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Store name</Label>
              <Input
                id="name"
                name="name"
                placeholder="Dragon's Den Games"
                required
                maxLength={120}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="discordWebhook">
                Discord webhook URL{" "}
                <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="discordWebhook"
                name="discordWebhook"
                type="url"
                placeholder="https://discord.com/api/webhooks/…"
              />
              <p className="text-xs text-muted-foreground">
                Price alerts will be posted to this channel. You can add or
                change it later.
              </p>
            </div>
            <Button type="submit" className="w-full">
              Create store
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
