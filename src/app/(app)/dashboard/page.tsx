import { requireStore } from "@/lib/tenancy";
import { PageHeader } from "@/components/page-header";

export default async function DashboardPage() {
  const ctx = await requireStore();
  return (
    <div>
      <PageHeader
        title="Dashboard"
        description={`Welcome back to ${ctx.storeName}.`}
      />
      <p className="text-sm text-muted-foreground">Dashboard coming online in a later phase.</p>
    </div>
  );
}
