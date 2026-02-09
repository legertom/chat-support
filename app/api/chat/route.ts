import { NextResponse } from "next/server";
import { calculateCost, DEFAULT_MODEL_ID, findModelSpec } from "@/lib/models";
import { callProvider } from "@/lib/providers";
import { buildRagSystemPrompt, trimConversation } from "@/lib/rag";
import { retrieveTopChunks } from "@/lib/retrieval";
import type { ChatMessageInput } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ChatRequestBody {
  messages?: ChatMessageInput[];
  modelId?: string;
  topK?: number;
  temperature?: number;
  maxOutputTokens?: number;
  apiKey?: string;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ChatRequestBody;
    const allowClientApiKeyOverride = process.env.ALLOW_CLIENT_API_KEY_OVERRIDE === "true";
    const messages = normalizeMessages(body.messages);

    if (!messages.length) {
      return NextResponse.json({ error: "At least one message is required." }, { status: 400 });
    }

    const latestUserMessage = findLatestUserMessage(messages);
    if (!latestUserMessage) {
      return NextResponse.json({ error: "A user message is required." }, { status: 400 });
    }

    const requestedModelId = body.modelId ?? DEFAULT_MODEL_ID;
    const modelId = findModelSpec(requestedModelId) ? requestedModelId : DEFAULT_MODEL_ID;
    if (!findModelSpec(modelId)) {
      return NextResponse.json({ error: "No supported models are configured." }, { status: 500 });
    }

    const topK = clampNumber(body.topK, 2, 10, 6);
    const temperature = clampNumber(body.temperature, 0, 1.2, 0.2);
    const maxOutputTokens = Math.round(clampNumber(body.maxOutputTokens, 256, 4096, 1200));

    const retrieval = await retrieveTopChunks(latestUserMessage.content, topK);
    const systemPrompt = buildRagSystemPrompt(retrieval);
    const trimmedMessages = trimConversation(messages);

    const providerResult = await callProvider({
      modelId,
      messages: trimmedMessages,
      systemPrompt,
      temperature,
      maxOutputTokens,
      apiKeyOverride: allowClientApiKeyOverride ? body.apiKey : undefined,
    });

    const cost = calculateCost(providerResult.usage, modelId);

    const citations = retrieval.map((item, idx) => ({
      index: idx + 1,
      title: item.chunk.title,
      url: item.chunk.url,
      chunkId: item.chunk.chunk_id,
      section: item.chunk.section ?? null,
      score: Number(item.score.toFixed(4)),
      snippet: item.snippet,
    }));

    return NextResponse.json({
      assistant: {
        role: "assistant",
        content: providerResult.text,
        usage: providerResult.usage,
        cost,
        modelId,
        provider: providerResult.provider,
        citations,
      },
      retrieval: {
        count: citations.length,
        topK,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected chat error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function normalizeMessages(messages: ChatMessageInput[] | undefined): ChatMessageInput[] {
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages
    .filter((message): message is ChatMessageInput => {
      return (
        message !== null &&
        typeof message === "object" &&
        (message.role === "user" || message.role === "assistant") &&
        typeof message.content === "string"
      );
    })
    .map((message) => ({
      role: message.role,
      content: message.content.trim(),
    }))
    .filter((message) => message.content.length > 0);
}

function findLatestUserMessage(messages: ChatMessageInput[]): ChatMessageInput | undefined {
  for (let idx = messages.length - 1; idx >= 0; idx -= 1) {
    const message = messages[idx];
    if (message.role === "user") {
      return message;
    }
  }
  return undefined;
}

function clampNumber(value: number | undefined, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, value));
}
