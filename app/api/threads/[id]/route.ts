import { NextResponse } from "next/server";
import { jsonError } from "@/lib/http";
import { requireDbUser } from "@/lib/server-auth";
import { getThreadWithStats } from "@/lib/thread-stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireDbUser();
    const { id: threadId } = await context.params;
    const result = await getThreadWithStats(threadId, user.id);
    return NextResponse.json(result);
  } catch (error) {
    return jsonError(error);
  }
}
