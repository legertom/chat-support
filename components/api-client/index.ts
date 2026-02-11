export interface MeResponse {
  user: {
    id: string;
    email: string;
    name: string | null;
    image: string | null;
    role: "admin" | "member";
    status: "active" | "disabled";
    createdAt: string;
    lastActiveAt: string | null;
  };
  wallet: {
    balanceCents: number;
    lifetimeGrantedCents: number;
    lifetimeSpentCents: number;
    debitedCents: number;
  };
}

export interface ThreadListResponse {
  items: ThreadListItem[];
  nextCursor: string | null;
}

export interface ThreadListItem {
  id: string;
  title: string;
  visibility: "org" | "private";
  createdAt: string;
  updatedAt: string;
  createdBy: {
    id: string;
    email: string;
    name: string | null;
  };
  messageCount: number;
  lastMessage: {
    id: string;
    role: "user" | "assistant" | "system";
    contentPreview: string;
    createdAt: string;
  } | null;
}

export interface ThreadDetailResponse {
  thread: {
    id: string;
    title: string;
    visibility: "org" | "private";
    createdAt: string;
    updatedAt: string;
    createdBy: {
      id: string;
      email: string;
      name: string | null;
    };
    feedback: {
      averageRating: number | null;
      count: number;
      mine: {
        rating: number;
        comment: string | null;
      } | null;
    };
  };
  messages: ThreadMessage[];
}

export interface ThreadMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  modelId: string | null;
  provider: string | null;
  usage: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  } | null;
  costCents: number;
  createdAt: string;
  user: {
    id: string;
    email: string;
    name: string | null;
  } | null;
  citations: Citation[];
  feedback: {
    averageRating: number | null;
    count: number;
    mine: {
      rating: number;
      comment: string | null;
    } | null;
  };
}

export interface Citation {
  id: string;
  chunkId: string;
  docId: string | null;
  url: string;
  title: string;
  section: string | null;
  score: number;
  snippet: string;
}

export interface ChatResponse {
  assistant: {
    id: string;
  };
  budget: {
    remainingBalanceCents: number;
    chargedCents: number;
    releasedCents: number;
    reservedCents: number;
  };
}

export type ApiKeyProvider = "openai" | "anthropic" | "gemini";

export interface UserApiKeyItem {
  id: string;
  provider: ApiKeyProvider;
  label: string;
  keyPreview: string;
  createdAt: string;
  updatedAt: string;
}

export interface UserApiKeysResponse {
  items: UserApiKeyItem[];
}

export interface StatsResponse {
  dataset: {
    articleCount: number;
    chunkCount: number;
    chunksPath: string;
    sourceDocCounts?: Record<string, number>;
    sourceChunkCounts?: Record<string, number>;
  };
  models: Array<{
    id: string;
    label: string;
    provider: string;
    apiModel: string;
  }>;
}

export async function fetchMe(): Promise<MeResponse> {
  const response = await fetch("/api/me", { method: "GET" });
  if (!response.ok) {
    if (response.status === 401) {
      window.location.href = "/signin";
      throw new Error("Unauthorized");
    }
    throw new Error(`Failed to load profile (${response.status})`);
  }
  return response.json();
}

export async function fetchThreads(scope: "all" | "mine", cursor?: string): Promise<ThreadListResponse> {
  const params = new URLSearchParams({ scope });
  if (cursor) {
    params.append("cursor", cursor);
  }
  const response = await fetch(`/api/threads?${params.toString()}`, { method: "GET" });
  if (!response.ok) {
    throw new Error(`Failed to load threads (${response.status})`);
  }
  return response.json();
}

export async function createThread(visibility: "org" | "private"): Promise<{ thread: { id: string } }> {
  const response = await fetch("/api/threads", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ visibility }),
  });
  if (!response.ok) {
    throw new Error(`Failed to create thread (${response.status})`);
  }
  return response.json();
}

export async function fetchThread(id: string): Promise<ThreadDetailResponse> {
  const response = await fetch(`/api/threads/${id}`, { method: "GET" });
  if (!response.ok) {
    throw new Error(`Failed to load thread (${response.status})`);
  }
  return response.json();
}

export interface PostMessageRequest {
  threadId: string;
  content: string;
  sources: string[];
  modelId: string;
  topK: number;
  temperature: number;
  maxOutputTokens: number;
  userApiKeyId: string | null;
}

export async function postMessage(body: PostMessageRequest): Promise<ChatResponse & {
  error?: string;
  code?: string;
  remainingBalanceCents?: number;
  ok: boolean;
  status: number;
}> {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok && response.status !== 402) {
    throw new Error(payload.error || `Failed to send message (${response.status})`);
  }
  return { ...payload, ok: response.ok, status: response.status };
}

export async function submitThreadFeedback(threadId: string, rating: number, comment?: string): Promise<void> {
  const response = await fetch(`/api/threads/${threadId}/feedback`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ rating, comment }),
  });
  if (!response.ok) {
    const payload = await response.json();
    throw new Error(payload.error || `Failed to save thread feedback (${response.status})`);
  }
}

export async function submitMessageFeedback(messageId: string, rating: number, comment?: string): Promise<void> {
  const response = await fetch(`/api/messages/${messageId}/feedback`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ rating, comment }),
  });
  if (!response.ok) {
    const payload = await response.json();
    throw new Error(payload.error || `Failed to save feedback (${response.status})`);
  }
}

export async function fetchApiKeys(): Promise<UserApiKeysResponse> {
  const response = await fetch("/api/me/keys", { method: "GET" });
  if (!response.ok) {
    throw new Error(`Failed to load API keys (${response.status})`);
  }
  return response.json();
}

export async function createApiKey(body: {
  provider: ApiKeyProvider;
  label: string;
  apiKey: string;
}): Promise<{ key: UserApiKeyItem }> {
  const response = await fetch("/api/me/keys", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || `Failed to save API key (${response.status})`);
  }
  return payload;
}

export async function deleteApiKey(id: string): Promise<void> {
  const response = await fetch(`/api/me/keys/${id}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    const payload = await response.json();
    throw new Error(payload.error || `Failed to delete API key (${response.status})`);
  }
}

export async function fetchStats(): Promise<StatsResponse> {
  const response = await fetch("/api/stats", { method: "GET" });
  if (!response.ok) {
    throw new Error(`Failed to load stats (${response.status})`);
  }
  return response.json();
}
