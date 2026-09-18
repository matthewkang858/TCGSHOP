import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { repriceRules } from "@/db/schema";
import { requireStore } from "@/lib/tenancy";
import { PageHeader } from "@/components/page-header";
import { RuleForm } from "../../rule-form";
import { updateRuleAction } from "../../actions";

export default async function EditRulePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await requireStore();
  const id = z.string().uuid().parse((await params).id);

  const [rule] = await db
    .select()
    .from(repriceRules)
    .where(and(eq(repriceRules.id, id), eq(repriceRules.storeId, ctx.storeId)));
  if (!rule) notFound();

  const boundUpdate = updateRuleAction.bind(null, rule.id);

  return (
    <div>
      <PageHeader
        title="Edit rule"
        description={`${rule.name} · priority ${rule.priority} · ${rule.active ? "active" : "inactive"}`}
      />
      <RuleForm rule={rule} action={boundUpdate} />
    </div>
  );
}
