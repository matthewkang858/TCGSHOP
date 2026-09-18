import Link from "next/link";
import { requireStore } from "@/lib/tenancy";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { ImportWizard } from "./wizard";

export default async function ImportPage() {
  await requireStore();
  return (
    <div>
      <PageHeader
        title="Import inventory"
        description="CSV · TCGplayer exports auto-detected · re-imports update lines, never duplicate them"
      >
        <Button asChild variant="outline">
          <Link href="/inventory">Back to inventory</Link>
        </Button>
      </PageHeader>
      <ImportWizard />
    </div>
  );
}
