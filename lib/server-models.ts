import "server-only";

import {
  MODEL_SPECS,
  buildModelId,
  findPresetModelSpecByApiModel,
  resolveModelPricingMetadata,
  type ModelSpec,
  type ProviderId,
} from "./models";

const PROVIDER_ENV_KEYS: Record<ProviderId, string[]> = {
  openai: ["OPENAI_API_KEY"],
  anthropic: ["ANTHROPIC_API_KEY"],
  gemini: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
};

const CATALOG_PROVIDER_ORDER: ProviderId[] = ["openai", "anthropic", "gemini"];
const MODEL_LIST_TIMEOUT_MS = 7000;
const MODEL_LIST_CACHE_TTL_MS = 5 * 60 * 1000;
const MODEL_NAME_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const OPENAI_EXCLUDED_MODEL_FRAGMENTS = [
  "audio",
  "transcribe",
  "tts",
  "realtime",
  "image",
  "search",
  "codex",
  "instruct",
];
const OPENAI_ALLOWED_MODELS = new Set(
  MODEL_SPECS.filter((model) => model.provider === "openai").map((model) => model.apiModel)
);

interface ProviderModelCacheEntry {
  expiresAt: number;
  models: string[];
}

const providerModelCache = new Map<string, ProviderModelCacheEntry>();

export function hasConfiguredServerKey(provider: ProviderId): boolean {
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

export async function getDynamicServerModelCatalog(options: {
  allowClientApiKeyOverride: boolean;
}): Promise<ModelSpec[]> {
  const providers = options.allowClientApiKeyOverride
    ? CATALOG_PROVIDER_ORDER
    : CATALOG_PROVIDER_ORDER.filter((provider) => hasConfiguredServerKey(provider));

  if (providers.length === 0) {
    return [];
  }

  const catalogs = await Promise.all(
    providers.map(async (provider) => {
      const serverApiKey = getConfiguredServerApiKey(provider);
      if (!serverApiKey) {
        return MODEL_SPECS.filter((model) => model.provider === provider);
      }

      try {
        const models = await listProviderModelsWithCache(provider, serverApiKey);
        if (models.length > 0) {
          return models.map((apiModel) => buildDynamicCatalogModel(provider, apiModel));
        }
      } catch {
        // Fall through to static presets if live model discovery fails.
      }

      return MODEL_SPECS.filter((model) => model.provider === provider);
    })
  );

  return dedupeAndSortCatalog(catalogs.flat());
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

function getConfiguredServerApiKey(provider: ProviderId): string | null {
  const envKeys = PROVIDER_ENV_KEYS[provider];
  for (const key of envKeys) {
    const value = process.env[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

async function listProviderModelsWithCache(provider: ProviderId, apiKey: string): Promise<string[]> {
  const cacheKey = `${provider}:${fingerprintApiKey(apiKey)}`;
  const cached = providerModelCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.models;
  }

  const models = await listProviderModels(provider, apiKey);
  providerModelCache.set(cacheKey, {
    expiresAt: Date.now() + MODEL_LIST_CACHE_TTL_MS,
    models,
  });
  return models;
}

async function listProviderModels(provider: ProviderId, apiKey: string): Promise<string[]> {
  if (provider === "openai") {
    return listOpenAiModels(apiKey);
  }
  if (provider === "anthropic") {
    return listAnthropicModels(apiKey);
  }
  return listGeminiModels(apiKey);
}

async function listOpenAiModels(apiKey: string): Promise<string[]> {
  const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const json = await fetchJson(`${baseUrl}/models`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  });

  if (!isRecord(json) || !Array.isArray(json.data)) {
    return [];
  }

  const models = json.data
    .map((item) => (isRecord(item) && typeof item.id === "string" ? item.id : null))
    .filter((modelId): modelId is string => !!modelId)
    .filter((modelId) => modelId.startsWith("gpt-"))
    .filter((modelId) => !OPENAI_EXCLUDED_MODEL_FRAGMENTS.some((fragment) => modelId.includes(fragment)))
    .filter((modelId) => OPENAI_ALLOWED_MODELS.has(modelId));

  return dedupeAndSortModelNames(models);
}

async function listAnthropicModels(apiKey: string): Promise<string[]> {
  const baseUrl = (process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/$/, "");
  const json = await fetchJson(`${baseUrl}/v1/models`, {
    method: "GET",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
  });

  if (!isRecord(json) || !Array.isArray(json.data)) {
    return [];
  }

  const models = json.data
    .map((item) => (isRecord(item) && typeof item.id === "string" ? item.id : null))
    .filter((modelId): modelId is string => !!modelId)
    .filter((modelId) => modelId.startsWith("claude"));

  return dedupeAndSortModelNames(models);
}

async function listGeminiModels(apiKey: string): Promise<string[]> {
  const baseUrl = (process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta").replace(
    /\/$/,
    ""
  );
  const json = await fetchJson(`${baseUrl}/models`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
  });

  if (!isRecord(json) || !Array.isArray(json.models)) {
    return [];
  }

  const models = json.models
    .map((item) => {
      if (!isRecord(item) || typeof item.name !== "string") {
        return null;
      }

      const supportedGenerationMethods = Array.isArray(item.supportedGenerationMethods)
        ? item.supportedGenerationMethods
            .filter((method): method is string => typeof method === "string")
            .map((method) => method.toLowerCase())
        : [];

      const canGenerateContent =
        supportedGenerationMethods.length === 0 || supportedGenerationMethods.includes("generatecontent");
      if (!canGenerateContent || !item.name.startsWith("models/")) {
        return null;
      }

      const apiModel = item.name.slice("models/".length).trim();
      if (!apiModel.startsWith("gemini")) {
        return null;
      }

      return apiModel;
    })
    .filter((modelId): modelId is string => !!modelId);

  return dedupeAndSortModelNames(models);
}

async function fetchJson(url: string, init: RequestInit): Promise<unknown> {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), MODEL_LIST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...init,
      cache: "no-store",
      signal: controller.signal,
    });

    const text = await response.text();
    const parsed = safeParseJson(text);
    if (!response.ok) {
      throw new Error(
        `Model discovery request failed (${response.status})${extractErrorSuffix(parsed, response.statusText)}`
      );
    }

    return parsed;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

function safeParseJson(text: string): unknown {
  if (!text.trim().length) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractErrorSuffix(payload: unknown, statusText: string): string {
  if (isRecord(payload)) {
    if (typeof payload.error === "string") {
      return `: ${payload.error}`;
    }

    if (isRecord(payload.error) && typeof payload.error.message === "string") {
      return `: ${payload.error.message}`;
    }

    if (typeof payload.message === "string") {
      return `: ${payload.message}`;
    }
  }

  return statusText ? `: ${statusText}` : "";
}

function buildDynamicCatalogModel(provider: ProviderId, apiModel: string): ModelSpec {
  const exactPreset = findPresetModelSpecByApiModel(provider, apiModel);
  if (exactPreset) {
    return exactPreset;
  }

  const pricingMetadata = resolveModelPricingMetadata(provider, apiModel);
  return {
    id: buildModelId(provider, apiModel),
    provider,
    apiModel,
    label: apiModel,
    description: `Dynamically discovered ${provider.toUpperCase()} model.`,
    ...pricingMetadata,
  };
}

function dedupeAndSortModelNames(models: string[]): string[] {
  return [...new Set(models)].sort((a, b) => MODEL_NAME_COLLATOR.compare(b, a));
}

function dedupeAndSortCatalog(models: ModelSpec[]): ModelSpec[] {
  const deduped = new Map<string, ModelSpec>();

  for (const model of models) {
    const id = buildModelId(model.provider, model.apiModel);
    if (deduped.has(id)) {
      continue;
    }

    deduped.set(id, {
      ...model,
      id,
    });
  }

  return [...deduped.values()].sort((left, right) => {
    if (left.provider !== right.provider) {
      return providerSortIndex(left.provider) - providerSortIndex(right.provider);
    }
    return MODEL_NAME_COLLATOR.compare(right.apiModel, left.apiModel);
  });
}

function providerSortIndex(provider: ProviderId): number {
  const index = CATALOG_PROVIDER_ORDER.indexOf(provider);
  return index >= 0 ? index : CATALOG_PROVIDER_ORDER.length;
}

function fingerprintApiKey(apiKey: string): string {
  let hash = 0;
  for (let index = 0; index < apiKey.length; index += 1) {
    hash = (hash * 31 + apiKey.charCodeAt(index)) >>> 0;
  }
  return `${apiKey.length}:${hash.toString(16)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
