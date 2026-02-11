import { redirect } from "next/navigation";
import { getDropdownModelCatalogForUser } from "@/lib/model-catalog";
import { requireDbUser } from "@/lib/server-auth";
import { ModelGuideClient } from "@/components/model-guide-client";

export const dynamic = "force-dynamic";

export default async function ModelsPage() {
  try {
    const user = await requireDbUser();
    const modelCatalog = await getDropdownModelCatalogForUser(user.id);

    return <ModelGuideClient initialModelCatalog={modelCatalog} />;
  } catch (error) {
    console.error("Models page error:", error);
    redirect("/signin");
  }
}
