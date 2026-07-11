import { requireStore } from "@/lib/tenancy";
import { PageHeader } from "@/components/page-header";
import { RuleForm } from "../../rule-form";
import { createRuleAction } from "../../actions";

export default async function NewRulePage() {
  await requireStore();
  return (
    <div>
      <PageHeader
        title="New repricing rule"
        description="Scope which inventory this rule covers, pick a market basis, and set the formula and guards."
      />
      <RuleForm action={createRuleAction} />
    </div>
  );
}
