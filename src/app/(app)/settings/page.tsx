import { eq } from "drizzle-orm";
import { db } from "@/db";
import { memberships, stores, users } from "@/db/schema";
import { env, OFFLINE_MODE } from "@/lib/env";
import { requireStore } from "@/lib/tenancy";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { EXPORT_FIELDS, TCGPLAYER_EXPORT_PRESET } from "@/lib/repricing/export";
import {
  inviteMemberAction,
  removeMemberAction,
  updateExportMappingAction,
  updateStoreSettingsAction,
} from "./actions";

export default async function SettingsPage() {
  const ctx = await requireStore();
  const [store] = await db.select().from(stores).where(eq(stores.id, ctx.storeId));
  const members = await db
    .select({
      userId: memberships.userId,
      role: memberships.role,
      email: users.email,
      name: users.name,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.storeId, ctx.storeId));

  const isOwner = ctx.role === "owner";
  const mapping = store.settings.export_mappings?.tcgplayer ?? TCGPLAYER_EXPORT_PRESET;
  const mappingRows = [...Object.entries(mapping), ["", ""] as [string, string]];

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="Store configuration, members, and integrations." />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Store</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={updateStoreSettingsAction} className="space-y-4">
              <label className="block space-y-1">
                <span className="text-sm font-medium">Store name</span>
                <Input name="name" defaultValue={store.name} required maxLength={120} />
              </label>
              <label className="block space-y-1">
                <span className="text-sm font-medium">Discord webhook URL</span>
                <Input
                  name="discordWebhook"
                  type="url"
                  placeholder="https://discord.com/api/webhooks/…"
                  defaultValue={store.settings.discord_webhook_url ?? ""}
                />
                <span className="text-xs text-muted-foreground">
                  Alerts post here with product, set, image, and price change.
                </span>
              </label>
              <div className="grid grid-cols-2 gap-4">
                <label className="block space-y-1">
                  <span className="text-sm font-medium">Snapshot staleness (hours)</span>
                  <Input
                    name="stalenessHours"
                    type="number"
                    min={1}
                    max={336}
                    defaultValue={store.settings.snapshot_staleness_hours ?? 24}
                  />
                  <span className="text-xs text-muted-foreground">
                    reprice runs re-sweep older data
                  </span>
                </label>
                <label className="block space-y-1">
                  <span className="text-sm font-medium">Default rounding</span>
                  <Select
                    name="defaultRounding"
                    defaultValue={store.settings.default_rounding ?? "psychological"}
                  >
                    <option value="psychological">Psychological (.49/.99)</option>
                    <option value="quarter">Quarter</option>
                    <option value="dollar">Dollar</option>
                    <option value="cents">Cents</option>
                  </Select>
                </label>
              </div>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="emailAlerts"
                  defaultChecked={store.settings.email_alerts ?? true}
                />
                <span className="text-sm font-medium">Email alerts to store owners</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="dashboardAnalytics"
                  defaultChecked={store.settings.dashboard_analytics ?? true}
                />
                <span className="text-sm font-medium">Show analytics charts on the dashboard</span>
              </label>
              <Button type="submit" disabled={!isOwner}>
                Save settings
              </Button>
              {!isOwner ? (
                <p className="text-xs text-muted-foreground">Only owners can edit settings.</p>
              ) : null}
            </form>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Data provider</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Mode</span>
                <Badge variant={OFFLINE_MODE ? "warning" : "success"}>
                  {OFFLINE_MODE ? "offline fixtures (no API key)" : "live TCGAPIs"}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Plan tier</span>
                <Badge variant="secondary">{env.TCGAPIS_TIER}</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Rate limit</span>
                <span>{env.TCGAPIS_RPM} rpm</span>
              </div>
              <p className="pt-2 text-xs text-muted-foreground">
                Configure via <code>TCGAPIS_API_KEY</code>, <code>TCGAPIS_TIER</code>, and{" "}
                <code>TCGAPIS_RPM</code> env vars. SKU-level condition pricing needs the
                Unlimited tier; price sweeps and sales stats need Business or up.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Billing</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {env.BILLING_ENABLED ? (
                <p>Billing is enabled. Manage your plan from the customer portal.</p>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Plan</span>
                    <Badge variant="secondary">Free preview</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Stripe billing (Starter / Pro tiers) ships behind{" "}
                    <code>BILLING_ENABLED</code> and is currently off. Everything is unlocked
                    in preview.
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Members</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {members.map((m) => (
              <div
                key={m.userId}
                className="flex items-center justify-between rounded-md border px-3 py-2"
              >
                <div>
                  <span className="text-sm font-medium">{m.name ?? m.email}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{m.email}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={m.role === "owner" ? "default" : "secondary"}>{m.role}</Badge>
                  {isOwner && m.userId !== ctx.userId ? (
                    <form action={removeMemberAction}>
                      <input type="hidden" name="userId" value={m.userId} />
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs text-destructive"
                        type="submit"
                      >
                        remove
                      </Button>
                    </form>
                  ) : null}
                </div>
              </div>
            ))}
            {isOwner ? (
              <form action={inviteMemberAction} className="flex items-end gap-2 border-t pt-3">
                <label className="flex-1 space-y-1">
                  <span className="text-sm font-medium">Invite by email</span>
                  <Input name="email" type="email" placeholder="teammate@store.com" required />
                </label>
                <Select name="role" className="w-28" defaultValue="member">
                  <option value="member">member</option>
                  <option value="owner">owner</option>
                </Select>
                <Button type="submit">Invite</Button>
              </form>
            ) : null}
            <p className="text-xs text-muted-foreground">
              Invited members sign in with a magic link to the same email.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Reprice export mapping (TCGplayer preset)</CardTitle>
            <p className="text-sm text-muted-foreground">
              Column headers for exported reprice CSVs. Edit to match your marketplace&apos;s
              current import format — formats drift.
            </p>
          </CardHeader>
          <CardContent>
            <form action={updateExportMappingAction} className="space-y-2">
              {mappingRows.map(([header, field], i) => (
                <div key={`${header}-${i}`} className="flex items-center gap-2">
                  <Input
                    name="map_header"
                    defaultValue={header}
                    placeholder={i === mappingRows.length - 1 ? "Add column header…" : ""}
                    className="flex-1"
                  />
                  <span className="text-muted-foreground">←</span>
                  <Select name="map_field" defaultValue={field} className="w-44">
                    <option value="">—</option>
                    {EXPORT_FIELDS.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </Select>
                </div>
              ))}
              <div className="flex justify-end pt-2">
                <Button type="submit" variant="outline">
                  Save mapping
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
