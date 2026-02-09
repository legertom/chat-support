import { NextResponse } from "next/server";
import { getChunkStats } from "@/lib/retrieval";
import { getServerModelCatalog } from "@/lib/server-models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const stats = await getChunkStats();
    const allowClientApiKeyOverride = process.env.ALLOW_CLIENT_API_KEY_OVERRIDE === "true";
    const modelCatalog = getServerModelCatalog({ allowClientApiKeyOverride });

    return NextResponse.json({
      dataset: stats,
      models: modelCatalog,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load dataset stats";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
