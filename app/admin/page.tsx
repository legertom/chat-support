import { redirect } from "next/navigation";
import { AdminConsole } from "@/components/admin-console";
import { requireAdminUser } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  try {
    await requireAdminUser();
  } catch {
    redirect("/");
  }

  return <AdminConsole />;
}
