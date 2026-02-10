export type ChatRole = "user" | "assistant" | "system";

export interface ChatMessageInput {
  role: ChatRole;
  content: string;
}

export interface UsageMetrics {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface CostMetrics {
  inputCostUsd: number;
  outputCostUsd: number;
  totalCostUsd: number;
  inputRateUsdPerMillion: number;
  outputRateUsdPerMillion: number;
  pricingTier: "standard" | "long-context" | "unknown";
  hasPricing: boolean;
}

export interface ChunkIndexDiagnostics {
  warmOnRequestStart: boolean;
  buildCount: number;
  lastBuildMs: number | null;
  builtAt: string | null;
}

export interface DeploymentDiagnostics {
  platform: string;
  region: string | null;
  environment: string | null;
  nodeEnv: string | null;
}

export interface RequestDiagnostics {
  totalMs: number;
  parseMs: number;
  retrievalMs: number;
  ragPromptMs: number;
  providerMs: number;
  responseBuildMs: number;
  coldStartLikely: boolean;
  chunkIndex: ChunkIndexDiagnostics;
  deployment: DeploymentDiagnostics;
}

export interface Citation {
  index: number;
  title: string;
  url: string;
  chunkId: string;
  docId?: string | null;
  section: string | null;
  score: number;
  snippet: string;
  multiplierApplied?: number;
}

export interface AssistantTurn {
  role: "assistant";
  content: string;
  usage: UsageMetrics;
  cost: CostMetrics;
  modelId: string;
  provider: string;
  citations: Citation[];
  diagnostics?: RequestDiagnostics;
}
