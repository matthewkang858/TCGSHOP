import { requireStore } from "@/lib/tenancy";
import { PageHeader } from "@/components/page-header";
import { RuleForm } from "../../rule-form";
import { createRuleAction } from "../../actions";

export default async function NewRulePage() {
  await requireStore();
  return (
    <div>
      <PageHeader
        title="New rule"
        description="Rules run in priority order · the first match prices each line"
      />
      <RuleForm action={createRuleAction} />
    </div>
  );
}
