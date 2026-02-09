import { NextResponse } from "next/server";
import { MODEL_SPECS } from "@/lib/models";
import { getChunkStats } from "@/lib/retrieval";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const stats = await getChunkStats();

    return NextResponse.json({
      dataset: stats,
      models: MODEL_SPECS,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load dataset stats";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
