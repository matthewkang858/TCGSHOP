import { redirect } from "next/navigation";
import { getSessionUser, getStoreContext } from "@/lib/tenancy";

export default async function Home() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const ctx = await getStoreContext();
  if (!ctx) redirect("/onboarding");
  redirect("/dashboard");
}
