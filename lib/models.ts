import type { CostMetrics, UsageMetrics } from "./types";

export type ProviderId = "openai" | "anthropic" | "gemini";

export interface ModelSpec {
  id: string;
  provider: ProviderId;
  apiModel: string;
  label: string;
  description: string;
  inputPerMillionUsd?: number;
  outputPerMillionUsd?: number;
  longContextThresholdTokens?: number;
  longContextInputPerMillionUsd?: number;
  longContextOutputPerMillionUsd?: number;
  pricingAsOf?: string;
  pricingSource?: string;
  pricingNotes?: string;
}

type ModelPricingMetadata = Pick<
  ModelSpec,
  | "inputPerMillionUsd"
  | "outputPerMillionUsd"
  | "longContextThresholdTokens"
  | "longContextInputPerMillionUsd"
  | "longContextOutputPerMillionUsd"
  | "pricingAsOf"
  | "pricingSource"
  | "pricingNotes"
>;

interface PricedModelMetadataOptions {
  source: string;
  asOf?: string;
  notes?: string;
  longContextThresholdTokens?: number;
  longContextInputPerMillionUsd?: number;
  longContextOutputPerMillionUsd?: number;
}

interface ModelPricingPatternRule {
  provider: ProviderId;
  pattern: RegExp;
  metadata: ModelPricingMetadata;
}

export const MODEL_PRICING_RESEARCH_DATE = "2026-02-10";
export const MODEL_PRICING_SOURCE_BY_PROVIDER: Record<ProviderId, string> = {
  openai: "https://platform.openai.com/docs/pricing",
  anthropic: "https://docs.anthropic.com/en/docs/about-claude/pricing",
  gemini: "https://ai.google.dev/gemini-api/docs/pricing",
};

function buildPricedMetadata(
  inputPerMillionUsd: number,
  outputPerMillionUsd: number,
  options: PricedModelMetadataOptions
): ModelPricingMetadata {
  return {
    inputPerMillionUsd,
    outputPerMillionUsd,
    longContextThresholdTokens: options.longContextThresholdTokens,
    longContextInputPerMillionUsd: options.longContextInputPerMillionUsd,
    longContextOutputPerMillionUsd: options.longContextOutputPerMillionUsd,
    pricingAsOf: options.asOf ?? MODEL_PRICING_RESEARCH_DATE,
    pricingSource: options.source,
    pricingNotes: options.notes,
  };
}

function buildUnresolvedMetadata(provider: ProviderId, reason: string): ModelPricingMetadata {
  return {
    pricingAsOf: MODEL_PRICING_RESEARCH_DATE,
    pricingSource: MODEL_PRICING_SOURCE_BY_PROVIDER[provider],
    pricingNotes: `Unresolved pricing: ${reason}`,
  };
}

const OPENAI_GPT_5_2_PRO_PRICING = buildPricedMetadata(21, 168, {
  source: MODEL_PRICING_SOURCE_BY_PROVIDER.openai,
});
const OPENAI_GPT_5_2_PRICING = buildPricedMetadata(1.75, 14, {
  source: MODEL_PRICING_SOURCE_BY_PROVIDER.openai,
});
const OPENAI_GPT_5_1_PRICING = buildPricedMetadata(1.25, 10, {
  source: MODEL_PRICING_SOURCE_BY_PROVIDER.openai,
});
const OPENAI_GPT_5_PRICING = buildPricedMetadata(1.25, 10, {
  source: MODEL_PRICING_SOURCE_BY_PROVIDER.openai,
});
const OPENAI_GPT_5_MINI_PRICING = buildPricedMetadata(0.25, 2, {
  source: MODEL_PRICING_SOURCE_BY_PROVIDER.openai,
});
const OPENAI_GPT_5_NANO_PRICING = buildPricedMetadata(0.05, 0.4, {
  source: MODEL_PRICING_SOURCE_BY_PROVIDER.openai,
});

const CLAUDE_OPUS_4_6_PRICING = buildPricedMetadata(15, 75, {
  source: MODEL_PRICING_SOURCE_BY_PROVIDER.anthropic,
  notes: "Input prompts over 200K tokens are billed at the long-context input rate.",
  longContextThresholdTokens: 200_000,
  longContextInputPerMillionUsd: 30,
  longContextOutputPerMillionUsd: 75,
});
const CLAUDE_OPUS_4_1_PRICING = buildPricedMetadata(15, 75, {
  source: MODEL_PRICING_SOURCE_BY_PROVIDER.anthropic,
});
const CLAUDE_OPUS_4_PRICING = buildPricedMetadata(15, 75, {
  source: MODEL_PRICING_SOURCE_BY_PROVIDER.anthropic,
});
const CLAUDE_SONNET_4_5_PRICING = buildPricedMetadata(3, 15, {
  source: MODEL_PRICING_SOURCE_BY_PROVIDER.anthropic,
  notes: "Input prompts over 200K tokens are billed at the long-context input rate.",
  longContextThresholdTokens: 200_000,
  longContextInputPerMillionUsd: 6,
  longContextOutputPerMillionUsd: 15,
});
const CLAUDE_SONNET_4_PRICING = buildPricedMetadata(3, 15, {
  source: MODEL_PRICING_SOURCE_BY_PROVIDER.anthropic,
});
const CLAUDE_SONNET_3_7_PRICING = buildPricedMetadata(3, 15, {
  source: MODEL_PRICING_SOURCE_BY_PROVIDER.anthropic,
});
const CLAUDE_SONNET_3_5_PRICING = buildPricedMetadata(3, 15, {
  source: MODEL_PRICING_SOURCE_BY_PROVIDER.anthropic,
});
const CLAUDE_HAIKU_4_5_PRICING = buildPricedMetadata(1, 5, {
  source: MODEL_PRICING_SOURCE_BY_PROVIDER.anthropic,
});
const CLAUDE_HAIKU_3_5_PRICING = buildPricedMetadata(0.8, 4, {
  source: MODEL_PRICING_SOURCE_BY_PROVIDER.anthropic,
});
const CLAUDE_OPUS_3_PRICING = buildPricedMetadata(15, 75, {
  source: MODEL_PRICING_SOURCE_BY_PROVIDER.anthropic,
});
const CLAUDE_HAIKU_3_PRICING = buildPricedMetadata(0.25, 1.25, {
  source: MODEL_PRICING_SOURCE_BY_PROVIDER.anthropic,
});

const GEMINI_2_5_PRO_PRICING = buildPricedMetadata(1.25, 10, {
  source: MODEL_PRICING_SOURCE_BY_PROVIDER.gemini,
  notes: "Text token pricing. Input over 200K tokens uses the long-context input rate.",
  longContextThresholdTokens: 200_000,
  longContextInputPerMillionUsd: 2.5,
  longContextOutputPerMillionUsd: 15,
});
const GEMINI_2_5_FLASH_PRICING = buildPricedMetadata(0.3, 2.5, {
  source: MODEL_PRICING_SOURCE_BY_PROVIDER.gemini,
  notes: "Text / image / video token pricing from Gemini Developer API pricing table.",
});
const GEMINI_2_5_FLASH_LITE_PRICING = buildPricedMetadata(0.1, 0.4, {
  source: MODEL_PRICING_SOURCE_BY_PROVIDER.gemini,
  notes: "Text / image / video token pricing from Gemini Developer API pricing table.",
});
const GEMINI_2_0_FLASH_PRICING = buildPricedMetadata(0.1, 0.4, {
  source: MODEL_PRICING_SOURCE_BY_PROVIDER.gemini,
  notes: "Text / image / video token pricing from Gemini Developer API pricing table.",
});
const GEMINI_2_0_FLASH_LITE_PRICING = buildPricedMetadata(0.075, 0.3, {
  source: MODEL_PRICING_SOURCE_BY_PROVIDER.gemini,
  notes: "Token pricing from Gemini Developer API pricing table.",
});
const GEMINI_3_PRO_PREVIEW_PRICING = buildPricedMetadata(2, 12, {
  source: MODEL_PRICING_SOURCE_BY_PROVIDER.gemini,
  notes: "Standard tier token pricing. Prompts over 200K tokens use long-context rates.",
  longContextThresholdTokens: 200_000,
  longContextInputPerMillionUsd: 4,
  longContextOutputPerMillionUsd: 18,
});
const GEMINI_3_FLASH_PREVIEW_PRICING = buildPricedMetadata(0.5, 3, {
  source: MODEL_PRICING_SOURCE_BY_PROVIDER.gemini,
  notes: "Standard text / image / video token pricing from Gemini Developer API pricing table.",
});
const GEMINI_3_PRO_IMAGE_PREVIEW_PRICING = buildPricedMetadata(2, 120, {
  source: MODEL_PRICING_SOURCE_BY_PROVIDER.gemini,
  notes:
    "Image model pricing normalized to token rates where published (text/image input $2/1M tokens, image output $120/1M tokens).",
});
const GEMINI_2_5_FLASH_IMAGE_PRICING = buildPricedMetadata(0.3, 30, {
  source: MODEL_PRICING_SOURCE_BY_PROVIDER.gemini,
  notes:
    "Image model pricing normalized to token rates where published (text/image input $0.30/1M tokens, image output $30/1M tokens).",
});
const GEMINI_2_5_FLASH_PREVIEW_TTS_PRICING = buildPricedMetadata(0.5, 10, {
  source: MODEL_PRICING_SOURCE_BY_PROVIDER.gemini,
  notes: "TTS model pricing in text-input and audio-output token units.",
});
const GEMINI_2_5_PRO_PREVIEW_TTS_PRICING = buildPricedMetadata(1, 20, {
  source: MODEL_PRICING_SOURCE_BY_PROVIDER.gemini,
  notes: "TTS model pricing in text-input and audio-output token units.",
});
const GEMINI_2_5_COMPUTER_USE_PREVIEW_PRICING = buildPricedMetadata(1.25, 10, {
  source: MODEL_PRICING_SOURCE_BY_PROVIDER.gemini,
  notes: "Standard tier token pricing. Prompts over 200K tokens use long-context rates.",
  longContextThresholdTokens: 200_000,
  longContextInputPerMillionUsd: 2.5,
  longContextOutputPerMillionUsd: 15,
});

const EXPLICIT_MODEL_PRICING_BY_KEY = new Map<string, ModelPricingMetadata>([
  ["openai:gpt-5.2-pro", OPENAI_GPT_5_2_PRO_PRICING],
  ["openai:gpt-5.2", OPENAI_GPT_5_2_PRICING],
  ["openai:gpt-5.1", OPENAI_GPT_5_1_PRICING],
  ["openai:gpt-5", OPENAI_GPT_5_PRICING],
  ["openai:gpt-5-mini", OPENAI_GPT_5_MINI_PRICING],
  ["openai:gpt-5-nano", OPENAI_GPT_5_NANO_PRICING],

  ["anthropic:claude-opus-4-6", CLAUDE_OPUS_4_6_PRICING],
  ["anthropic:claude-opus-4-6-20260114", CLAUDE_OPUS_4_6_PRICING],
  ["anthropic:claude-opus-4-1", CLAUDE_OPUS_4_1_PRICING],
  ["anthropic:claude-opus-4-1-20250805", CLAUDE_OPUS_4_1_PRICING],
  ["anthropic:claude-opus-4-0", CLAUDE_OPUS_4_PRICING],
  ["anthropic:claude-opus-4-20250514", CLAUDE_OPUS_4_PRICING],
  ["anthropic:claude-sonnet-4-5", CLAUDE_SONNET_4_5_PRICING],
  ["anthropic:claude-sonnet-4-5-20250929", CLAUDE_SONNET_4_5_PRICING],
  ["anthropic:claude-sonnet-4-0", CLAUDE_SONNET_4_PRICING],
  ["anthropic:claude-sonnet-4-20250514", CLAUDE_SONNET_4_PRICING],
  ["anthropic:claude-haiku-4-5", CLAUDE_HAIKU_4_5_PRICING],
  ["anthropic:claude-haiku-4-5-20251001", CLAUDE_HAIKU_4_5_PRICING],
  ["anthropic:claude-3-7-sonnet-latest", CLAUDE_SONNET_3_7_PRICING],
  ["anthropic:claude-3-7-sonnet-20250219", CLAUDE_SONNET_3_7_PRICING],
  ["anthropic:claude-3-5-sonnet-latest", CLAUDE_SONNET_3_5_PRICING],
  ["anthropic:claude-3-5-sonnet-20241022", CLAUDE_SONNET_3_5_PRICING],
  ["anthropic:claude-3-5-sonnet-20240620", CLAUDE_SONNET_3_5_PRICING],
  ["anthropic:claude-3-5-haiku-latest", CLAUDE_HAIKU_3_5_PRICING],
  ["anthropic:claude-3-5-haiku-20241022", CLAUDE_HAIKU_3_5_PRICING],
  ["anthropic:claude-3-opus-20240229", CLAUDE_OPUS_3_PRICING],
  ["anthropic:claude-3-haiku-20240307", CLAUDE_HAIKU_3_PRICING],

  ["gemini:gemini-2.5-pro", GEMINI_2_5_PRO_PRICING],
  ["gemini:gemini-2.5-pro-preview-06-05", GEMINI_2_5_PRO_PRICING],
  ["gemini:gemini-2.5-pro-preview-05-06", GEMINI_2_5_PRO_PRICING],
  ["gemini:gemini-3-pro-preview", GEMINI_3_PRO_PREVIEW_PRICING],
  ["gemini:gemini-3-flash-preview", GEMINI_3_FLASH_PREVIEW_PRICING],
  ["gemini:gemini-3-pro-image-preview", GEMINI_3_PRO_IMAGE_PREVIEW_PRICING],
  ["gemini:gemini-2.5-flash", GEMINI_2_5_FLASH_PRICING],
  ["gemini:gemini-2.5-flash-preview-05-20", GEMINI_2_5_FLASH_PRICING],
  ["gemini:gemini-2.5-flash-preview-09-2025", GEMINI_2_5_FLASH_PRICING],
  ["gemini:gemini-2.5-flash-image", GEMINI_2_5_FLASH_IMAGE_PRICING],
  ["gemini:gemini-2.5-flash-preview-tts", GEMINI_2_5_FLASH_PREVIEW_TTS_PRICING],
  ["gemini:gemini-2.5-flash-lite", GEMINI_2_5_FLASH_LITE_PRICING],
  ["gemini:gemini-2.5-flash-lite-preview-06-17", GEMINI_2_5_FLASH_LITE_PRICING],
  ["gemini:gemini-2.5-flash-lite-preview-09-2025", GEMINI_2_5_FLASH_LITE_PRICING],
  ["gemini:gemini-2.5-pro-preview-tts", GEMINI_2_5_PRO_PREVIEW_TTS_PRICING],
  ["gemini:gemini-2.5-computer-use-preview-10-2025", GEMINI_2_5_COMPUTER_USE_PREVIEW_PRICING],
  ["gemini:gemini-2.0-flash", GEMINI_2_0_FLASH_PRICING],
  ["gemini:gemini-2.0-flash-lite", GEMINI_2_0_FLASH_LITE_PRICING],
  [
    "gemini:gemini-2.0-flash-preview-image-generation",
    buildUnresolvedMetadata(
      "gemini",
      "Google publishes image-generation pricing separately and does not provide a text-token input/output pair for this model ID."
    ),
  ],
  [
    "gemini:gemini-2.0-flash-exp-image-generation",
    buildUnresolvedMetadata(
      "gemini",
      "Official Gemini pricing docs do not list this exact model ID with a standalone token input/output pricing table."
    ),
  ],
  [
    "gemini:gemini-flash-latest",
    buildUnresolvedMetadata(
      "gemini",
      "The '-latest' alias target changes over time and the docs do not pin this alias to one priced model ID."
    ),
  ],
  [
    "gemini:gemini-flash-lite-latest",
    buildUnresolvedMetadata(
      "gemini",
      "The '-latest' alias target changes over time and the docs do not pin this alias to one priced model ID."
    ),
  ],
  [
    "gemini:gemini-pro-latest",
    buildUnresolvedMetadata(
      "gemini",
      "The '-latest' alias target changes over time and the docs do not pin this alias to one priced model ID."
    ),
  ],
  [
    "gemini:gemini-exp-1206",
    buildUnresolvedMetadata(
      "gemini",
      "Official Gemini pricing docs do not currently include this exact experimental model ID in a token pricing table."
    ),
  ],
  [
    "anthropic:claude-opus-4-5",
    buildUnresolvedMetadata(
      "anthropic",
      "Current Anthropic official model/pricing docs do not include a published token pricing row for this model ID."
    ),
  ],
  [
    "anthropic:claude-opus-4-5-20251001",
    buildUnresolvedMetadata(
      "anthropic",
      "Current Anthropic official model/pricing docs do not include a published token pricing row for this model ID."
    ),
  ],
]);

const MODEL_PRICING_PATTERNS: ModelPricingPatternRule[] = [
  {
    provider: "anthropic",
    pattern: /^claude-opus-4-6(?:-\d{8})?$/,
    metadata: CLAUDE_OPUS_4_6_PRICING,
  },
  {
    provider: "anthropic",
    pattern: /^claude-opus-4-1(?:-\d{8})?$/,
    metadata: CLAUDE_OPUS_4_1_PRICING,
  },
  {
    provider: "anthropic",
    pattern: /^claude-opus-4(?:-(?:0|\d{8}))?$/,
    metadata: CLAUDE_OPUS_4_PRICING,
  },
  {
    provider: "anthropic",
    pattern: /^claude-sonnet-4-5(?:-\d{8})?$/,
    metadata: CLAUDE_SONNET_4_5_PRICING,
  },
  {
    provider: "anthropic",
    pattern: /^claude-sonnet-4(?:-(?:0|\d{8}))?$/,
    metadata: CLAUDE_SONNET_4_PRICING,
  },
  {
    provider: "anthropic",
    pattern: /^claude-haiku-4-5(?:-\d{8})?$/,
    metadata: CLAUDE_HAIKU_4_5_PRICING,
  },
  {
    provider: "anthropic",
    pattern: /^claude-3-7-sonnet(?:-(?:latest|\d{8}))?$/,
    metadata: CLAUDE_SONNET_3_7_PRICING,
  },
  {
    provider: "anthropic",
    pattern: /^claude-3-5-sonnet(?:-(?:latest|\d{8}))?$/,
    metadata: CLAUDE_SONNET_3_5_PRICING,
  },
  {
    provider: "anthropic",
    pattern: /^claude-3-5-haiku(?:-(?:latest|\d{8}))?$/,
    metadata: CLAUDE_HAIKU_3_5_PRICING,
  },
  {
    provider: "anthropic",
    pattern: /^claude-3-opus(?:-(?:latest|\d{8}))?$/,
    metadata: CLAUDE_OPUS_3_PRICING,
  },
  {
    provider: "anthropic",
    pattern: /^claude-3-haiku(?:-(?:latest|\d{8}))?$/,
    metadata: CLAUDE_HAIKU_3_PRICING,
  },
  {
    provider: "gemini",
    pattern: /^gemini-2\.5-pro(?:-preview-(?:\d{2}-\d{2}|\d{2}-\d{4}))?$/,
    metadata: GEMINI_2_5_PRO_PRICING,
  },
  {
    provider: "gemini",
    pattern: /^gemini-2\.5-flash(?:-preview-(?:\d{2}-\d{2}|\d{2}-\d{4}))?$/,
    metadata: GEMINI_2_5_FLASH_PRICING,
  },
  {
    provider: "gemini",
    pattern: /^gemini-2\.5-flash-lite(?:-preview-(?:\d{2}-\d{2}|\d{2}-\d{4}))?$/,
    metadata: GEMINI_2_5_FLASH_LITE_PRICING,
  },
  {
    provider: "gemini",
    pattern: /^gemini-2\.0-flash(?:-\d{3})?$/,
    metadata: GEMINI_2_0_FLASH_PRICING,
  },
  {
    provider: "gemini",
    pattern: /^gemini-2\.0-flash-lite(?:-\d{3})?$/,
    metadata: GEMINI_2_0_FLASH_LITE_PRICING,
  },
];

function buildLookupVariants(apiModel: string): string[] {
  const variants = new Set<string>();
  const withoutIsoDate = apiModel.replace(/-\d{4}-\d{2}-\d{2}$/, "");
  if (withoutIsoDate !== apiModel) {
    variants.add(withoutIsoDate);
  }

  const withoutCompactDate = apiModel.replace(/-\d{8}$/, "");
  if (withoutCompactDate !== apiModel) {
    variants.add(withoutCompactDate);
  }

  if (apiModel.endsWith("-latest")) {
    variants.add(apiModel.replace(/-latest$/, ""));
  }

  return [...variants];
}

function withInferredPricingNote(metadata: ModelPricingMetadata, inferredFromApiModel: string): ModelPricingMetadata {
  const notePrefix = `Pricing inferred from ${inferredFromApiModel}.`;
  if (typeof metadata.pricingNotes === "string" && metadata.pricingNotes.length > 0) {
    return {
      ...metadata,
      pricingNotes: `${notePrefix} ${metadata.pricingNotes}`,
    };
  }

  return {
    ...metadata,
    pricingNotes: notePrefix,
  };
}

export function resolveModelPricingMetadata(provider: ProviderId, apiModel: string): ModelPricingMetadata {
  const direct = EXPLICIT_MODEL_PRICING_BY_KEY.get(`${provider}:${apiModel}`);
  if (direct) {
    return { ...direct };
  }

  for (const variant of buildLookupVariants(apiModel)) {
    const variantMatch = EXPLICIT_MODEL_PRICING_BY_KEY.get(`${provider}:${variant}`);
    if (variantMatch) {
      return withInferredPricingNote(variantMatch, variant);
    }
  }

  for (const rule of MODEL_PRICING_PATTERNS) {
    if (rule.provider === provider && rule.pattern.test(apiModel)) {
      return { ...rule.metadata };
    }
  }

  return buildUnresolvedMetadata(
    provider,
    `No official token pricing is published for model ID '${apiModel}' in current provider documentation.`
  );
}

export function modelHasVerifiedPricing(model: ModelSpec): boolean {
  return (
    typeof model.inputPerMillionUsd === "number" &&
    typeof model.outputPerMillionUsd === "number" &&
    typeof model.pricingAsOf === "string" &&
    model.pricingAsOf.trim().length > 0 &&
    typeof model.pricingSource === "string" &&
    model.pricingSource.trim().length > 0
  );
}

export function modelHasExplicitUnresolvedPricing(model: ModelSpec): boolean {
  if (modelHasVerifiedPricing(model)) {
    return false;
  }

  return (
    typeof model.pricingAsOf === "string" &&
    model.pricingAsOf.trim().length > 0 &&
    typeof model.pricingSource === "string" &&
    model.pricingSource.trim().length > 0 &&
    typeof model.pricingNotes === "string" &&
    /unresolved pricing/i.test(model.pricingNotes)
  );
}

export function modelHasPricingCoverage(model: ModelSpec): boolean {
  return modelHasVerifiedPricing(model) || modelHasExplicitUnresolvedPricing(model);
}

export const MODEL_SPECS: ModelSpec[] = [
  {
    id: "openai:gpt-5.2-pro",
    provider: "openai",
    apiModel: "gpt-5.2-pro",
    label: "GPT-5.2 Pro",
    description: "Newest high-end GPT model for the best answer quality.",
    ...OPENAI_GPT_5_2_PRO_PRICING,
  },
  {
    id: "openai:gpt-5.2",
    provider: "openai",
    apiModel: "gpt-5.2",
    label: "GPT-5.2",
    description: "Newest general-purpose GPT model.",
    ...OPENAI_GPT_5_2_PRICING,
  },
  {
    id: "openai:gpt-5.1",
    provider: "openai",
    apiModel: "gpt-5.1",
    label: "GPT-5.1",
    description: "Recent GPT model with strong quality and lower cost than Pro.",
    ...OPENAI_GPT_5_1_PRICING,
  },
  {
    id: "openai:gpt-5",
    provider: "openai",
    apiModel: "gpt-5",
    label: "GPT-5",
    description: "Stable GPT-5 baseline model.",
    ...OPENAI_GPT_5_PRICING,
  },
  {
    id: "openai:gpt-5-mini",
    provider: "openai",
    apiModel: "gpt-5-mini",
    label: "GPT-5 mini",
    description: "Best default for cost-quality balance in support QA.",
    ...OPENAI_GPT_5_MINI_PRICING,
  },
  {
    id: "openai:gpt-5-nano",
    provider: "openai",
    apiModel: "gpt-5-nano",
    label: "GPT-5 nano",
    description: "Lowest-cost GPT preset for lightweight runs.",
    ...OPENAI_GPT_5_NANO_PRICING,
  },
];

export const DEFAULT_MODEL_ID = "openai:gpt-5-mini";

const MODEL_BY_ID = new Map(MODEL_SPECS.map((spec) => [spec.id, spec]));
const PRESET_BY_PROVIDER_AND_API_MODEL = new Map(
  MODEL_SPECS.map((spec) => [toPresetKey(spec.provider, spec.apiModel), spec])
);

export function findModelSpec(modelId: string): ModelSpec | undefined {
  return MODEL_BY_ID.get(modelId);
}

export function findPresetModelSpecByApiModel(provider: ProviderId, apiModel: string): ModelSpec | undefined {
  return PRESET_BY_PROVIDER_AND_API_MODEL.get(toPresetKey(provider, apiModel));
}

export function buildModelId(provider: ProviderId, apiModel: string): string {
  return `${provider}:${apiModel}`;
}

export function parseModelId(modelId: string): { provider: ProviderId; apiModel: string } | null {
  const separatorIndex = modelId.indexOf(":");
  if (separatorIndex <= 0 || separatorIndex >= modelId.length - 1) {
    return null;
  }

  const providerRaw = modelId.slice(0, separatorIndex);
  const apiModel = modelId.slice(separatorIndex + 1).trim();
  if (!apiModel.length) {
    return null;
  }

  if (providerRaw !== "openai" && providerRaw !== "anthropic" && providerRaw !== "gemini") {
    return null;
  }

  return {
    provider: providerRaw,
    apiModel,
  };
}

export function calculateCost(usage: UsageMetrics, modelId: string, modelSpecOverride?: ModelSpec): CostMetrics {
  const spec = resolveCostModelSpec(modelId, modelSpecOverride);
  const hasBasePricing =
    !!spec && typeof spec.inputPerMillionUsd === "number" && typeof spec.outputPerMillionUsd === "number";

  if (!spec || !hasBasePricing) {
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

  let useLongContextTier = false;
  if (
    typeof spec.longContextThresholdTokens === "number" &&
    typeof spec.longContextInputPerMillionUsd === "number" &&
    typeof spec.longContextOutputPerMillionUsd === "number"
  ) {
    useLongContextTier = usage.inputTokens > spec.longContextThresholdTokens;
  }

  const inputRateUsdPerMillion = useLongContextTier
    ? spec.longContextInputPerMillionUsd ?? spec.inputPerMillionUsd
    : spec.inputPerMillionUsd;

  const outputRateUsdPerMillion = useLongContextTier
    ? spec.longContextOutputPerMillionUsd ?? spec.outputPerMillionUsd
    : spec.outputPerMillionUsd;

  if (typeof inputRateUsdPerMillion !== "number" || typeof outputRateUsdPerMillion !== "number") {
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

function toPresetKey(provider: ProviderId, apiModel: string): string {
  return `${provider}:${apiModel}`;
}

function resolveCostModelSpec(modelId: string, modelSpecOverride?: ModelSpec): ModelSpec | undefined {
  if (modelSpecOverride) {
    return modelSpecOverride;
  }

  const direct = findModelSpec(modelId);
  if (direct) {
    return direct;
  }

  const parsedModel = parseModelId(modelId);
  if (!parsedModel) {
    return undefined;
  }

  const exactPreset = findPresetModelSpecByApiModel(parsedModel.provider, parsedModel.apiModel);
  if (exactPreset) {
    return exactPreset;
  }

  const resolvedPricing = resolveModelPricingMetadata(parsedModel.provider, parsedModel.apiModel);
  if (
    typeof resolvedPricing.inputPerMillionUsd === "number" &&
    typeof resolvedPricing.outputPerMillionUsd === "number"
  ) {
    return {
      id: modelId,
      provider: parsedModel.provider,
      apiModel: parsedModel.apiModel,
      label: parsedModel.apiModel,
      description: `Pricing-resolved ${parsedModel.provider.toUpperCase()} model.`,
      ...resolvedPricing,
    };
  }

  return undefined;
}
