import { requireStore } from "@/lib/tenancy";
import { PageHeader } from "@/components/page-header";
import { ImportWizard } from "./wizard";

export default async function ImportPage() {
  await requireStore();
  return (
    <div>
      <PageHeader
        title="Import inventory"
        description="Upload a CSV, map its columns, review the catalog matches, and commit. Re-imports update existing lines."
      />
      <ImportWizard />
    </div>
  );
}
