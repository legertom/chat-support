import { NextResponse } from "next/server";
import { getChunkStats } from "@/lib/retrieval";
import { jsonError } from "@/lib/http";
import { requireDbUser } from "@/lib/server-auth";
import { getStatsModelCatalogForUser } from "@/lib/model-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireDbUser();
    const stats = await getChunkStats();
    const modelCatalog = await getStatsModelCatalogForUser(user.id);

    return NextResponse.json({
      dataset: stats,
      models: modelCatalog,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return jsonError(error);
  }
}
