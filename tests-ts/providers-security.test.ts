import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("provider key transport security", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
  });

  it("sends Gemini key via header (not query string) for generation calls", async () => {
    process.env.GEMINI_API_KEY = "AIzaTestKey123456789";

    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [{ text: "ok" }],
            },
          },
        ],
        usageMetadata: {
          promptTokenCount: 3,
          candidatesTokenCount: 5,
          totalTokenCount: 8,
        },
      }),
    }));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const { callProvider } = await import("@/lib/providers");
    await callProvider({
      modelId: "gemini:gemini-2.0-flash",
      messages: [{ role: "user", content: "hi" }],
      systemPrompt: "sys",
      temperature: 0.2,
      maxOutputTokens: 32,
    });

    const firstCall = fetchMock.mock.calls[0];
    expect(firstCall).toBeDefined();
    const [url, init] = firstCall as unknown as [string, RequestInit];
    expect(url).toContain("/models/gemini-2.0-flash:generateContent");
    expect(url).not.toContain("?key=");
    expect(init.headers).toMatchObject({
      "x-goog-api-key": "AIzaTestKey123456789",
    });
  });

  it("keeps server-side Gemini model discovery on header auth (no query-string key)", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "lib/server-models.ts"), "utf8");
    const geminiSection = source.slice(source.indexOf("async function listGeminiModels"));

    expect(geminiSection).toContain("\"x-goog-api-key\": apiKey");
    expect(geminiSection).not.toContain("?key=");
  });
});
