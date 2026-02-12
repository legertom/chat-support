import { findModelSpec, parseModelId } from "./models";
import type { ChatMessageInput } from "./types";

interface StreamProviderCallParams {
  modelId: string;
  messages: ChatMessageInput[];
  systemPrompt: string;
  temperature: number;
  maxOutputTokens: number;
  apiKeyOverride?: string;
}

export interface StreamProviderCallResult {
  modelId: string;
  provider: string;
  apiModel: string;
  stream: ReadableStream<string>;
}

export function callProviderStreaming(params: StreamProviderCallParams): StreamProviderCallResult {
  const modelSpec = findModelSpec(params.modelId);
  const parsedModel = parseModelId(params.modelId);

  const provider = modelSpec?.provider ?? parsedModel?.provider;
  const apiModel = modelSpec?.apiModel ?? parsedModel?.apiModel;

  if (!provider || !apiModel) {
    throw new Error(`Unsupported model ID format: ${params.modelId}`);
  }

  if (provider === "openai") {
    return callOpenAiStreaming({ ...params, apiModel, provider: "openai" });
  }

  if (provider === "anthropic") {
    return callAnthropicStreaming({ ...params, apiModel, provider: "anthropic" });
  }

  if (provider === "gemini") {
    return callGeminiStreaming({ ...params, apiModel, provider: "gemini" });
  }

  throw new Error(`No streaming adapter implemented for provider: ${provider}`);
}

function isOpenAiResponsesModel(model: string): boolean {
  return model.includes("-pro");
}

function usesMaxCompletionTokens(model: string): boolean {
  return model.startsWith("gpt-5") && !isOpenAiResponsesModel(model);
}

function supportsCustomTemperature(model: string): boolean {
  return !model.startsWith("gpt-5") && !isOpenAiResponsesModel(model);
}

function callOpenAiStreaming(
  params: StreamProviderCallParams & { apiModel: string; provider: "openai" }
): StreamProviderCallResult {
  const apiKey = params.apiKeyOverride?.trim() || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing OpenAI API key.");
  }

  const isResponsesModel = isOpenAiResponsesModel(params.apiModel);
  const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const endpoint = isResponsesModel ? `${baseUrl}/responses` : `${baseUrl}/chat/completions`;

  const requestBody: Record<string, unknown> = {
    model: params.apiModel,
    stream: true,
  };

  if (isResponsesModel) {
    requestBody.input = [
      { role: "system", content: params.systemPrompt },
      ...params.messages.map((m) => ({ role: m.role, content: m.content })),
    ];
    requestBody.max_output_tokens = params.maxOutputTokens;
  } else {
    requestBody.messages = [
      { role: "system", content: params.systemPrompt },
      ...params.messages.map((m) => ({ role: m.role, content: m.content })),
    ];
    if (supportsCustomTemperature(params.apiModel)) {
      requestBody.temperature = params.temperature;
    }
    if (usesMaxCompletionTokens(params.apiModel)) {
      requestBody.max_completion_tokens = params.maxOutputTokens;
    } else {
      requestBody.max_tokens = params.maxOutputTokens;
    }
  }

  const stream = new ReadableStream<string>({
    async start(controller) {
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          const errorText = await response.text();
          controller.error(new Error(`OpenAI API error (${response.status}): ${errorText}`));
          return;
        }

        const reader = response.body?.getReader();
        if (!reader) {
          controller.error(new Error("No response body"));
          return;
        }

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith("data: ")) continue;
            const data = trimmed.slice(6);
            if (data === "[DONE]") continue;

            try {
              const parsed = JSON.parse(data);
              if (isResponsesModel) {
                // Responses API streaming format
                if (parsed.type === "response.output_text.delta") {
                  const delta = parsed.delta;
                  if (delta) controller.enqueue(delta);
                }
              } else {
                // Chat completions streaming format
                const delta = parsed.choices?.[0]?.delta?.content;
                if (delta) controller.enqueue(delta);
              }
            } catch {
              // Skip unparseable lines
            }
          }
        }

        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });

  return {
    modelId: params.modelId,
    provider: params.provider,
    apiModel: params.apiModel,
    stream,
  };
}

function callAnthropicStreaming(
  params: StreamProviderCallParams & { apiModel: string; provider: "anthropic" }
): StreamProviderCallResult {
  const apiKey = params.apiKeyOverride?.trim() || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Missing Anthropic API key.");
  }

  const baseUrl = (process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/$/, "");

  const stream = new ReadableStream<string>({
    async start(controller) {
      try {
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
            stream: true,
            messages: params.messages.map((m) => ({ role: m.role, content: m.content })),
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          controller.error(new Error(`Anthropic API error (${response.status}): ${errorText}`));
          return;
        }

        const reader = response.body?.getReader();
        if (!reader) {
          controller.error(new Error("No response body"));
          return;
        }

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith("data: ")) continue;
            const data = trimmed.slice(6);

            try {
              const parsed = JSON.parse(data);
              if (parsed.type === "content_block_delta" && parsed.delta?.text) {
                controller.enqueue(parsed.delta.text);
              }
            } catch {
              // Skip unparseable lines
            }
          }
        }

        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });

  return {
    modelId: params.modelId,
    provider: params.provider,
    apiModel: params.apiModel,
    stream,
  };
}

function callGeminiStreaming(
  params: StreamProviderCallParams & { apiModel: string; provider: "gemini" }
): StreamProviderCallResult {
  const apiKey =
    params.apiKeyOverride?.trim() || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error("Missing Gemini API key.");
  }

  const baseUrl = (
    process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta"
  ).replace(/\/$/, "");
  const endpoint = `${baseUrl}/models/${encodeURIComponent(params.apiModel)}:streamGenerateContent?alt=sse`;

  const stream = new ReadableStream<string>({
    async start(controller) {
      try {
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
            contents: params.messages.map((m) => ({
              role: m.role === "assistant" ? "model" : "user",
              parts: [{ text: m.content }],
            })),
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          controller.error(new Error(`Gemini API error (${response.status}): ${errorText}`));
          return;
        }

        const reader = response.body?.getReader();
        if (!reader) {
          controller.error(new Error("No response body"));
          return;
        }

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith("data: ")) continue;
            const data = trimmed.slice(6);

            try {
              const parsed = JSON.parse(data);
              const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
              if (text) controller.enqueue(text);
            } catch {
              // Skip unparseable lines
            }
          }
        }

        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });

  return {
    modelId: params.modelId,
    provider: params.provider,
    apiModel: params.apiModel,
    stream,
  };
}
