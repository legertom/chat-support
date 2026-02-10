import { NextResponse } from "next/server";
import { runChatTurn } from "@/lib/chat";
import { ApiError, jsonError } from "@/lib/http";
import { parseJsonBody } from "@/lib/request";
import { requireDbUser } from "@/lib/server-auth";
import { chatRequestSchema } from "@/lib/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const user = await requireDbUser();
    const body = await parseJsonBody(request, chatRequestSchema);

    const result = await runChatTurn({
      userId: user.id,
      threadId: body.threadId,
      content: body.content,
      sources: body.sources,
      modelId: body.modelId,
      topK: body.topK,
      temperature: body.temperature,
      maxOutputTokens: body.maxOutputTokens,
      userApiKeyId: body.userApiKeyId ?? undefined,
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ApiError && error.status === 402 && error.code?.startsWith("insufficient_balance:")) {
      const remainingRaw = error.code.split(":")[1] ?? "0";
      const remainingBalanceCents = Number.parseInt(remainingRaw, 10) || 0;

      return NextResponse.json(
        {
          error: error.message,
          code: "insufficient_balance",
          remainingBalanceCents,
        },
        { status: 402 }
      );
    }

    return jsonError(error);
  }
}
