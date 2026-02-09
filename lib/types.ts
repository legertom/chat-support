export type ChatRole = "user" | "assistant";

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

export interface Citation {
  index: number;
  title: string;
  url: string;
  chunkId: string;
  section: string | null;
  score: number;
  snippet: string;
}

export interface AssistantTurn {
  role: "assistant";
  content: string;
  usage: UsageMetrics;
  cost: CostMetrics;
  modelId: string;
  provider: string;
  citations: Citation[];
}
