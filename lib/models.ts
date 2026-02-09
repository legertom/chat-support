import type { CostMetrics, UsageMetrics } from "./types";

export type ProviderId = "openai" | "anthropic" | "gemini";

export interface ModelSpec {
  id: string;
  provider: ProviderId;
  apiModel: string;
  label: string;
  description: string;
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
  longContextThresholdTokens?: number;
  longContextInputPerMillionUsd?: number;
  longContextOutputPerMillionUsd?: number;
  pricingAsOf: string;
  pricingSource: string;
  pricingNotes?: string;
}

export const MODEL_SPECS: ModelSpec[] = [
  {
    id: "openai:gpt-5",
    provider: "openai",
    apiModel: "gpt-5",
    label: "GPT-5",
    description: "High-quality OpenAI model for best answer quality.",
    inputPerMillionUsd: 1.25,
    outputPerMillionUsd: 10,
    pricingAsOf: "2026-02-08",
    pricingSource: "https://openai.com/api/pricing/",
  },
  {
    id: "openai:gpt-5-mini",
    provider: "openai",
    apiModel: "gpt-5-mini",
    label: "GPT-5 mini",
    description: "Best default for cost-quality balance in support QA.",
    inputPerMillionUsd: 0.25,
    outputPerMillionUsd: 2,
    pricingAsOf: "2026-02-08",
    pricingSource: "https://openai.com/api/pricing/",
  },
  {
    id: "openai:gpt-5-nano",
    provider: "openai",
    apiModel: "gpt-5-nano",
    label: "GPT-5 nano",
    description: "Lowest-cost OpenAI option for fast experiments.",
    inputPerMillionUsd: 0.05,
    outputPerMillionUsd: 0.4,
    pricingAsOf: "2026-02-08",
    pricingSource: "https://openai.com/api/pricing/",
  },
  {
    id: "anthropic:claude-opus-4-6",
    provider: "anthropic",
    apiModel: "claude-opus-4-6",
    label: "Claude Opus 4.6",
    description: "Top-tier Claude reasoning and instruction-following model.",
    inputPerMillionUsd: 5,
    outputPerMillionUsd: 25,
    longContextThresholdTokens: 200_000,
    longContextInputPerMillionUsd: 10,
    longContextOutputPerMillionUsd: 37.5,
    pricingAsOf: "2026-02-08",
    pricingSource: "https://docs.anthropic.com/en/docs/about-claude/models/overview",
    pricingNotes: "Prompts over 200K tokens use higher pricing.",
  },
  {
    id: "anthropic:claude-sonnet-4-5",
    provider: "anthropic",
    apiModel: "claude-sonnet-4-5",
    label: "Claude Sonnet 4.5",
    description: "Balanced Claude model for quality, speed, and cost.",
    inputPerMillionUsd: 3,
    outputPerMillionUsd: 15,
    longContextThresholdTokens: 200_000,
    longContextInputPerMillionUsd: 6,
    longContextOutputPerMillionUsd: 22.5,
    pricingAsOf: "2026-02-08",
    pricingSource: "https://docs.anthropic.com/en/docs/about-claude/models/overview",
    pricingNotes: "Prompts over 200K tokens use higher pricing.",
  },
  {
    id: "anthropic:claude-haiku-4-5",
    provider: "anthropic",
    apiModel: "claude-haiku-4-5",
    label: "Claude Haiku 4.5",
    description: "Fast and affordable Claude option.",
    inputPerMillionUsd: 1,
    outputPerMillionUsd: 5,
    pricingAsOf: "2026-02-08",
    pricingSource: "https://docs.anthropic.com/en/docs/about-claude/models/overview",
  },
  {
    id: "gemini:gemini-2.5-pro",
    provider: "gemini",
    apiModel: "gemini-2.5-pro",
    label: "Gemini 2.5 Pro",
    description: "High-end Gemini model.",
    inputPerMillionUsd: 1.25,
    outputPerMillionUsd: 10,
    longContextThresholdTokens: 200_000,
    longContextInputPerMillionUsd: 2.5,
    longContextOutputPerMillionUsd: 15,
    pricingAsOf: "2026-02-08",
    pricingSource: "https://ai.google.dev/gemini-api/docs/pricing",
    pricingNotes: "Prompts over 200K tokens use higher pricing.",
  },
  {
    id: "gemini:gemini-2.5-flash",
    provider: "gemini",
    apiModel: "gemini-2.5-flash",
    label: "Gemini 2.5 Flash",
    description: "Fast Gemini model with strong quality.",
    inputPerMillionUsd: 0.3,
    outputPerMillionUsd: 2.5,
    pricingAsOf: "2026-02-08",
    pricingSource: "https://ai.google.dev/gemini-api/docs/pricing",
  },
  {
    id: "gemini:gemini-2.5-flash-lite",
    provider: "gemini",
    apiModel: "gemini-2.5-flash-lite",
    label: "Gemini 2.5 Flash-Lite",
    description: "Lowest-cost Gemini option in this preset list.",
    inputPerMillionUsd: 0.1,
    outputPerMillionUsd: 0.4,
    pricingAsOf: "2026-02-08",
    pricingSource: "https://ai.google.dev/gemini-api/docs/pricing",
  },
];

export const DEFAULT_MODEL_ID = "openai:gpt-5-mini";

const MODEL_BY_ID = new Map(MODEL_SPECS.map((spec) => [spec.id, spec]));

export function findModelSpec(modelId: string): ModelSpec | undefined {
  return MODEL_BY_ID.get(modelId);
}

export function calculateCost(usage: UsageMetrics, modelId: string): CostMetrics {
  const spec = findModelSpec(modelId);
  if (!spec) {
    return {
      inputCostUsd: 0,
      outputCostUsd: 0,
      totalCostUsd: 0,
      inputRateUsdPerMillion: 0,
      outputRateUsdPerMillion: 0,
      pricingTier: "unknown",
      hasPricing: false,
    };
  }

  const useLongContextTier =
    typeof spec.longContextThresholdTokens === "number" &&
    usage.inputTokens > spec.longContextThresholdTokens &&
    typeof spec.longContextInputPerMillionUsd === "number" &&
    typeof spec.longContextOutputPerMillionUsd === "number";

  const inputRateUsdPerMillion = useLongContextTier
    ? spec.longContextInputPerMillionUsd ?? spec.inputPerMillionUsd
    : spec.inputPerMillionUsd;

  const outputRateUsdPerMillion = useLongContextTier
    ? spec.longContextOutputPerMillionUsd ?? spec.outputPerMillionUsd
    : spec.outputPerMillionUsd;

  const inputCostUsd = (usage.inputTokens / 1_000_000) * inputRateUsdPerMillion;
  const outputCostUsd = (usage.outputTokens / 1_000_000) * outputRateUsdPerMillion;

  return {
    inputCostUsd,
    outputCostUsd,
    totalCostUsd: inputCostUsd + outputCostUsd,
    inputRateUsdPerMillion,
    outputRateUsdPerMillion,
    pricingTier: useLongContextTier ? "long-context" : "standard",
    hasPricing: true,
  };
}
