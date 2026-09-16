"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStore } from "@/lib/tenancy";
import { enqueueJob } from "@/jobs/boss";
import { JOB } from "@/jobs/names";

const syncSchema = z.object({
  categoryId: z.coerce.number().int().positive().optional(),
});

/** Manual catalog sync trigger - enqueues a background job (worker processes it). */
export async function triggerCatalogSync(formData: FormData) {
  await requireStore(); // any signed-in store member may refresh the shared catalog
  const { categoryId } = syncSchema.parse({
    categoryId: formData.get("categoryId") || undefined,
  });
  await enqueueJob(JOB.CATALOG_SYNC, categoryId ? { categoryId } : {});
  revalidatePath("/products");
}
