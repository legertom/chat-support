import "server-only";

import { MODEL_SPECS, type ModelSpec, type ProviderId } from "./models";

const PROVIDER_ENV_KEYS: Record<ProviderId, string[]> = {
  openai: ["OPENAI_API_KEY"],
  anthropic: ["ANTHROPIC_API_KEY"],
  gemini: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
};

function hasConfiguredServerKey(provider: ProviderId): boolean {
  const envKeys = PROVIDER_ENV_KEYS[provider];
  return envKeys.some((key) => {
    const value = process.env[key];
    return typeof value === "string" && value.trim().length > 0;
  });
}

export function getServerModelCatalog(options: { allowClientApiKeyOverride: boolean }): ModelSpec[] {
  if (options.allowClientApiKeyOverride) {
    return MODEL_SPECS;
  }

  return MODEL_SPECS.filter((model) => hasConfiguredServerKey(model.provider));
}

export function resolveServerModelId(
  requestedModelId: string | undefined,
  catalog: ModelSpec[],
  defaultModelId: string
): string | null {
  if (catalog.length === 0) {
    return null;
  }

  if (typeof requestedModelId === "string" && catalog.some((model) => model.id === requestedModelId)) {
    return requestedModelId;
  }

  const defaultModel = catalog.find((model) => model.id === defaultModelId);
  if (defaultModel) {
    return defaultModel.id;
  }

  return catalog[0].id;
}
