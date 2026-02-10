import { findModelSpec, parseModelId } from "./models";
import { estimateTokens } from "./tokens";
import type { ChatMessageInput, UsageMetrics } from "./types";

interface ProviderCallParams {
  modelId: string;
  messages: ChatMessageInput[];
  systemPrompt: string;
  temperature: number;
  maxOutputTokens: number;
  apiKeyOverride?: string;
}

export interface ProviderCallResult {
  modelId: string;
  provider: string;
  apiModel: string;
  text: string;
  usage: UsageMetrics;
}

export async function callProvider(params: ProviderCallParams): Promise<ProviderCallResult> {
  const modelSpec = findModelSpec(params.modelId);
  const parsedModel = parseModelId(params.modelId);

  const provider = modelSpec?.provider ?? parsedModel?.provider;
  const apiModel = modelSpec?.apiModel ?? parsedModel?.apiModel;

  if (!provider || !apiModel) {
    throw new Error(`Unsupported model ID format: ${params.modelId}`);
  }

  if (provider === "openai") {
    return callOpenAi({ ...params, apiModel, provider });
  }

  if (provider === "anthropic") {
    return callAnthropic({ ...params, apiModel, provider });
  }

  if (provider === "gemini") {
    return callGemini({ ...params, apiModel, provider });
  }

  throw new Error(`No adapter implemented for provider: ${provider as string}`);
}

async function callOpenAi(
  params: ProviderCallParams & {
    apiModel: string;
    provider: "openai";
  }
): Promise<ProviderCallResult> {
  const apiKey = params.apiKeyOverride?.trim() || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing OpenAI API key. Set OPENAI_API_KEY or provide a key in the UI.");
  }

  const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");

  const requestBody: Record<string, unknown> = {
    model: params.apiModel,
    messages: [
      { role: "system", content: params.systemPrompt },
      ...params.messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
    ],
  };

  if (supportsCustomTemperature(params.apiModel)) {
    requestBody.temperature = params.temperature;
  }

  if (usesMaxCompletionTokens(params.apiModel)) {
    requestBody.max_completion_tokens = params.maxOutputTokens;
  } else {
    requestBody.max_tokens = params.maxOutputTokens;
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
  });

  const json = (await response.json()) as Record<string, unknown>;

  if (!response.ok) {
    throw new Error(`OpenAI API error (${response.status}): ${extractErrorMessage(json)}`);
  }

  const choices = Array.isArray(json.choices) ? json.choices : [];
  const firstChoice = choices[0] as { message?: { content?: unknown } } | undefined;
  const text = normalizeContent(firstChoice?.message?.content);

  const usageObj = (json.usage ?? {}) as Record<string, unknown>;
  const usage = normalizeUsage({
    inputTokens: toNumber(usageObj.prompt_tokens),
    outputTokens: toNumber(usageObj.completion_tokens),
    totalTokens: toNumber(usageObj.total_tokens),
    fallbackInputText: `${params.systemPrompt}\n${params.messages.map((m) => m.content).join("\n")}`,
    fallbackOutputText: text,
  });

  return {
    modelId: params.modelId,
    provider: params.provider,
    apiModel: params.apiModel,
    text,
    usage,
  };
}

async function callAnthropic(
  params: ProviderCallParams & {
    apiModel: string;
    provider: "anthropic";
  }
): Promise<ProviderCallResult> {
  const apiKey = params.apiKeyOverride?.trim() || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Missing Anthropic API key. Set ANTHROPIC_API_KEY or provide a key in the UI.");
  }

  const baseUrl = (process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/$/, "");

  const response = await fetch(`${baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: params.apiModel,
      system: params.systemPrompt,
      temperature: params.temperature,
      max_tokens: params.maxOutputTokens,
      messages: params.messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
    }),
  });

  const json = (await response.json()) as Record<string, unknown>;

  if (!response.ok) {
    throw new Error(`Anthropic API error (${response.status}): ${extractErrorMessage(json)}`);
  }

  const content = Array.isArray(json.content) ? json.content : [];
  const text = content
    .map((item) => (item as { text?: unknown }).text)
    .map(normalizeContent)
    .filter((chunk) => chunk.length > 0)
    .join("\n");

  const usageObj = (json.usage ?? {}) as Record<string, unknown>;
  const usage = normalizeUsage({
    inputTokens: toNumber(usageObj.input_tokens),
    outputTokens: toNumber(usageObj.output_tokens),
    totalTokens: null,
    fallbackInputText: `${params.systemPrompt}\n${params.messages.map((m) => m.content).join("\n")}`,
    fallbackOutputText: text,
  });

  return {
    modelId: params.modelId,
    provider: params.provider,
    apiModel: params.apiModel,
    text,
    usage,
  };
}

async function callGemini(
  params: ProviderCallParams & {
    apiModel: string;
    provider: "gemini";
  }
): Promise<ProviderCallResult> {
  const apiKey =
    params.apiKeyOverride?.trim() || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

  if (!apiKey) {
    throw new Error(
      "Missing Gemini API key. Set GEMINI_API_KEY/GOOGLE_API_KEY or provide a key in the UI."
    );
  }

  const baseUrl = (process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta").replace(
    /\/$/,
    ""
  );

  const endpoint = `${baseUrl}/models/${encodeURIComponent(params.apiModel)}:generateContent`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: params.systemPrompt }],
      },
      generationConfig: {
        temperature: params.temperature,
        maxOutputTokens: params.maxOutputTokens,
      },
      contents: params.messages.map((message) => ({
        role: message.role === "assistant" ? "model" : "user",
        parts: [{ text: message.content }],
      })),
    }),
  });

  const json = (await response.json()) as Record<string, unknown>;

  if (!response.ok) {
    throw new Error(`Gemini API error (${response.status}): ${extractErrorMessage(json)}`);
  }

  const candidates = Array.isArray(json.candidates) ? json.candidates : [];
  const first = candidates[0] as { content?: { parts?: Array<{ text?: unknown }> } } | undefined;
  const parts = first?.content?.parts ?? [];
  const text = parts
    .map((part) => normalizeContent(part.text))
    .filter((chunk) => chunk.length > 0)
    .join("\n");

  const usageObj = (json.usageMetadata ?? {}) as Record<string, unknown>;
  const usage = normalizeUsage({
    inputTokens: toNumber(usageObj.promptTokenCount),
    outputTokens: toNumber(usageObj.candidatesTokenCount),
    totalTokens: toNumber(usageObj.totalTokenCount),
    fallbackInputText: `${params.systemPrompt}\n${params.messages.map((m) => m.content).join("\n")}`,
    fallbackOutputText: text,
  });

  return {
    modelId: params.modelId,
    provider: params.provider,
    apiModel: params.apiModel,
    text,
    usage,
  };
}

function normalizeContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }
        if (item && typeof item === "object" && "text" in item) {
          const text = (item as { text?: unknown }).text;
          return typeof text === "string" ? text : "";
        }
        return "";
      })
      .join("\n")
      .trim();
  }
  return "";
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return null;
}

function normalizeUsage(args: {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  fallbackInputText: string;
  fallbackOutputText: string;
}): UsageMetrics {
  const fallbackInput = estimateTokens(args.fallbackInputText);
  const fallbackOutput = estimateTokens(args.fallbackOutputText);

  const inputTokens = args.inputTokens ?? fallbackInput;
  const outputTokens = args.outputTokens ?? fallbackOutput;
  const totalTokens = args.totalTokens ?? inputTokens + outputTokens;

  return {
    inputTokens,
    outputTokens,
    totalTokens,
  };
}

function extractErrorMessage(json: Record<string, unknown>): string {
  if (typeof json.error === "string") {
    return json.error;
  }

  if (json.error && typeof json.error === "object") {
    const errorObj = json.error as Record<string, unknown>;
    if (typeof errorObj.message === "string") {
      return errorObj.message;
    }
    if (typeof errorObj.type === "string") {
      return errorObj.type;
    }
  }

  if (typeof json.message === "string") {
    return json.message;
  }

  return "Unknown error";
}

function usesMaxCompletionTokens(model: string): boolean {
  return model.startsWith("gpt-5");
}

function supportsCustomTemperature(model: string): boolean {
  return !model.startsWith("gpt-5");
}
