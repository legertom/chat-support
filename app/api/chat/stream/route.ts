import { ApiError, jsonError } from "@/lib/http";
import { parseJsonBody } from "@/lib/request";
import { requireDbUser } from "@/lib/server-auth";
import { chatRequestSchema } from "@/lib/validators";
import { prepareChatRequest } from "@/lib/chat/prepare-request";
import { callProviderStreaming } from "@/lib/providers-streaming";
import { callProvider } from "@/lib/providers";
import { calculateCost } from "@/lib/models";
import { retrieveTopChunks } from "@/lib/retrieval";
import { getRetrievalMultiplierMap } from "@/lib/retrieval-weighting";
import { buildRagSystemPrompt, trimConversation } from "@/lib/rag";
import { estimateMaxTurnCostCents, reserveBudget, usdToCentsCeil } from "@/lib/wallet";
import { finalizeChatResponse } from "@/lib/chat/finalize-response";
import { prisma } from "@/lib/db/prisma";
import { estimateTokens } from "@/lib/tokens";
import type { ChatTurnExecution } from "@/lib/chat/execute-turn";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const user = await requireDbUser();
    const body = await parseJsonBody(request, chatRequestSchema);

    const prepared = await prepareChatRequest({
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

    // Prepare retrieval and system prompt (same as non-streaming)
    const history = await prisma.message.findMany({
      where: { threadId: prepared.thread.id },
      orderBy: { createdAt: "asc" },
      take: 24,
      select: { role: true, content: true },
    });

    const conversation = history
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role, content: m.content }));

    const multipliers = await getRetrievalMultiplierMap();
    const retrieval = await retrieveTopChunks(prepared.userMessage.content, prepared.topK, multipliers, {
      sources: body.sources,
    });
    const systemPrompt = buildRagSystemPrompt(retrieval);
    const trimmedMessages = trimConversation(conversation);

    // Reserve budget
    const costEstimate = estimateMaxTurnCostCents({
      modelId: prepared.modelId,
      modelSpec: prepared.modelSpec,
      systemPrompt,
      messages: trimmedMessages,
      maxOutputTokens: prepared.maxOutputTokens,
    });

    let reservedBudgetCents = 0;
    if (!prepared.usingPersonalApiKey) {
      await reserveBudget({
        userId: prepared.thread.createdByUserId,
        amountCents: costEstimate.estimatedCostCents,
        requestId: prepared.requestId,
        threadId: prepared.thread.id,
        modelId: prepared.modelId,
        provider: prepared.parsedModel.provider,
        metadata: {
          inputTokensEstimate: costEstimate.inputTokensEstimate,
          outputTokensEstimate: costEstimate.outputTokensEstimate,
          pricingTier: costEstimate.pricingTier,
        },
      });
      reservedBudgetCents = costEstimate.estimatedCostCents;
    }

    // Call the streaming provider
    let streamResult;
    try {
      streamResult = callProviderStreaming({
        modelId: prepared.modelId,
        messages: trimmedMessages,
        systemPrompt,
        temperature: prepared.temperature,
        maxOutputTokens: prepared.maxOutputTokens,
        apiKeyOverride: prepared.apiKeyOverride,
      });
    } catch {
      throw new ApiError(502, "Model provider request failed.", "provider_request_failed");
    }

    // Build SSE response that streams text chunks, then sends a final metadata event
    const encoder = new TextEncoder();
    const providerStream = streamResult.stream;

    const sseStream = new ReadableStream({
      async start(controller) {
        let fullText = "";
        const reader = providerStream.getReader();

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            fullText += value;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "delta", text: value })}\n\n`));
          }

          // Now finalize: calculate cost, save to DB
          const inputText = `${systemPrompt}\n${trimmedMessages.map((m) => m.content).join("\n")}`;
          const inputTokens = estimateTokens(inputText);
          const outputTokens = estimateTokens(fullText);

          // Also make a non-streaming call to get accurate usage from the provider?
          // No - we'll use token estimation for streaming. The cost savings from streaming
          // far outweigh minor token count imprecision.
          const usage = { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens };

          const measuredCost = calculateCost(usage, prepared.modelId, prepared.modelSpec);
          const actualCostCents = prepared.usingPersonalApiKey ? 0 : usdToCentsCeil(measuredCost.totalCostUsd);

          const execution: ChatTurnExecution = {
            providerResult: {
              modelId: prepared.modelId,
              provider: streamResult.provider,
              apiModel: streamResult.apiModel,
              text: fullText,
              usage,
            },
            measuredCost,
            actualCostCents,
            reservedBudgetCents,
            retrieval,
            systemPrompt,
            trimmedMessages,
          };

          const result = await finalizeChatResponse(prepared, execution);

          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "done", result })}\n\n`)
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : "Stream error";
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "error", error: message })}\n\n`)
          );
        } finally {
          controller.close();
        }
      },
    });

    return new Response(sseStream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 402 && error.code?.startsWith("insufficient_balance:")) {
      const remainingRaw = error.code.split(":")[1] ?? "0";
      const remainingBalanceCents = Number.parseInt(remainingRaw, 10) || 0;

      return Response.json(
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
