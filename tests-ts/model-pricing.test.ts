import { describe, expect, it } from "vitest";
import {
  MODEL_SPECS,
  modelHasExplicitUnresolvedPricing,
  modelHasPricingCoverage,
  modelHasVerifiedPricing,
  parseModelId,
  resolveModelPricingMetadata,
  type ModelSpec,
} from "@/lib/models";

const EFFECTIVE_DROPDOWN_MODEL_IDS = [
  "openai:gpt-5.2-pro",
  "openai:gpt-5.2",
  "openai:gpt-5.1",
  "openai:gpt-5",
  "openai:gpt-5-mini",
  "openai:gpt-5-nano",

  "anthropic:claude-opus-4-6",
  "anthropic:claude-opus-4-6-20260114",
  "anthropic:claude-sonnet-4-5",
  "anthropic:claude-sonnet-4-5-20250929",
  "anthropic:claude-haiku-4-5",
  "anthropic:claude-haiku-4-5-20251001",
  "anthropic:claude-opus-4-1",
  "anthropic:claude-opus-4-1-20250805",
  "anthropic:claude-opus-4-0",
  "anthropic:claude-opus-4-20250514",
  "anthropic:claude-sonnet-4-0",
  "anthropic:claude-sonnet-4-20250514",
  "anthropic:claude-3-7-sonnet-latest",
  "anthropic:claude-3-7-sonnet-20250219",
  "anthropic:claude-3-5-sonnet-latest",
  "anthropic:claude-3-5-sonnet-20241022",
  "anthropic:claude-3-5-sonnet-20240620",
  "anthropic:claude-3-5-haiku-latest",
  "anthropic:claude-3-5-haiku-20241022",
  "anthropic:claude-3-opus-20240229",
  "anthropic:claude-3-haiku-20240307",
  "anthropic:claude-opus-4-5-20251001",

  "gemini:gemini-2.5-pro",
  "gemini:gemini-2.5-pro-preview-06-05",
  "gemini:gemini-2.5-pro-preview-05-06",
  "gemini:gemini-3-pro-preview",
  "gemini:gemini-3-flash-preview",
  "gemini:gemini-3-pro-image-preview",
  "gemini:gemini-2.5-flash",
  "gemini:gemini-2.5-flash-preview-05-20",
  "gemini:gemini-2.5-flash-preview-09-2025",
  "gemini:gemini-2.5-flash-image",
  "gemini:gemini-2.5-flash-preview-tts",
  "gemini:gemini-2.5-flash-lite",
  "gemini:gemini-2.5-flash-lite-preview-06-17",
  "gemini:gemini-2.5-flash-lite-preview-09-2025",
  "gemini:gemini-2.5-pro-preview-tts",
  "gemini:gemini-2.5-computer-use-preview-10-2025",
  "gemini:gemini-2.0-flash",
  "gemini:gemini-2.0-flash-lite",
  "gemini:gemini-2.0-flash-preview-image-generation",
  "gemini:gemini-2.0-flash-exp-image-generation",
  "gemini:gemini-exp-1206",
  "gemini:gemini-flash-latest",
  "gemini:gemini-flash-lite-latest",
  "gemini:gemini-pro-latest",
] as const;

const EXPECTED_UNRESOLVED_MODEL_IDS = new Set<string>([
  "anthropic:claude-opus-4-5-20251001",
  "gemini:gemini-2.0-flash-preview-image-generation",
  "gemini:gemini-2.0-flash-exp-image-generation",
  "gemini:gemini-exp-1206",
  "gemini:gemini-flash-latest",
  "gemini:gemini-flash-lite-latest",
  "gemini:gemini-pro-latest",
]);

function materializeModelSpec(modelId: string): ModelSpec {
  const existing = MODEL_SPECS.find((model) => model.id === modelId);
  if (existing) {
    return existing;
  }

  const parsed = parseModelId(modelId);
  if (!parsed) {
    throw new Error(`Invalid model ID in pricing guard test: ${modelId}`);
  }

  return {
    id: modelId,
    provider: parsed.provider,
    apiModel: parsed.apiModel,
    label: parsed.apiModel,
    description: "Model pricing audit test fixture",
    ...resolveModelPricingMetadata(parsed.provider, parsed.apiModel),
  };
}

describe("model pricing coverage", () => {
  it("requires complete verified pricing metadata for static model presets", () => {
    for (const model of MODEL_SPECS) {
      expect(
        modelHasVerifiedPricing(model),
        `MODEL_SPECS entry '${model.id}' must include input/output rates, pricing source, and pricing date.`
      ).toBe(true);
    }
  });

  it("covers the effective dropdown model set with verified or explicitly unresolved pricing", () => {
    expect(new Set(EFFECTIVE_DROPDOWN_MODEL_IDS).size).toBe(EFFECTIVE_DROPDOWN_MODEL_IDS.length);

    for (const modelId of EFFECTIVE_DROPDOWN_MODEL_IDS) {
      const model = materializeModelSpec(modelId);

      expect(
        modelHasPricingCoverage(model),
        `Model '${modelId}' must be either fully priced or explicitly marked unresolved with notes.`
      ).toBe(true);

      if (EXPECTED_UNRESOLVED_MODEL_IDS.has(modelId)) {
        expect(
          modelHasExplicitUnresolvedPricing(model),
          `Model '${modelId}' should remain explicitly unresolved until official token rates are published.`
        ).toBe(true);
      } else {
        expect(modelHasVerifiedPricing(model), `Model '${modelId}' should have verified pricing metadata.`).toBe(true);
      }
    }
  });
});
