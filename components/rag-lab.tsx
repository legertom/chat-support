"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DEFAULT_MODEL_ID, MODEL_SPECS, findModelSpec, type ModelSpec } from "@/lib/models";
import { estimateTokens, usd } from "@/lib/tokens";
import type { Citation, CostMetrics, UsageMetrics } from "@/lib/types";

type UiRole = "user" | "assistant";

interface UiMessage {
  id: string;
  role: UiRole;
  content: string;
  createdAt: string;
  estimatedTokens?: number;
  usage?: UsageMetrics;
  cost?: CostMetrics;
  modelId?: string;
  provider?: string;
  citations?: Citation[];
}

interface UiThread {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: UiMessage[];
}

interface ThreadStore {
  activeThreadId: string;
  threads: UiThread[];
}

interface DatasetStats {
  articleCount: number;
  chunkCount: number;
  chunksPath: string;
}

interface StatsResponse {
  dataset: DatasetStats;
  models: ModelSpec[];
  generatedAt: string;
}

interface ChatResponse {
  assistant: {
    role: "assistant";
    content: string;
    usage: UsageMetrics;
    cost: CostMetrics;
    modelId: string;
    provider: string;
    citations: Citation[];
  };
}

const SETTINGS_STORAGE_KEY = "clever-rag-lab-settings-v1";
const THREADS_STORAGE_KEY = "clever-rag-lab-threads-v1";
const DEFAULT_THREAD_TITLE = "New thread";
const MAX_THREAD_TITLE_LENGTH = 72;
const ALLOW_CLIENT_API_KEY_OVERRIDE = process.env.NEXT_PUBLIC_ALLOW_CLIENT_API_KEY_OVERRIDE === "true";

export function RagLab() {
  const [threads, setThreads] = useState<UiThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState("");
  const [threadsHydrated, setThreadsHydrated] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<DatasetStats | null>(null);
  const [catalog, setCatalog] = useState<ModelSpec[]>(MODEL_SPECS);
  const [modelId, setModelId] = useState(DEFAULT_MODEL_ID);
  const [temperature, setTemperature] = useState(0.2);
  const [topK, setTopK] = useState(6);
  const [maxOutputTokens, setMaxOutputTokens] = useState(1200);
  const [apiKey, setApiKey] = useState("");
  const activeThreadIdRef = useRef(activeThreadId);

  useEffect(() => {
    activeThreadIdRef.current = activeThreadId;
  }, [activeThreadId]);

  useEffect(() => {
    const saved = loadSettings();
    if (saved) {
      if (typeof saved.modelId === "string") {
        setModelId(coerceModelId(saved.modelId, MODEL_SPECS));
      }
      if (typeof saved.temperature === "number") {
        setTemperature(saved.temperature);
      }
      if (typeof saved.topK === "number") {
        setTopK(saved.topK);
      }
      if (typeof saved.maxOutputTokens === "number") {
        setMaxOutputTokens(saved.maxOutputTokens);
      }
      if (ALLOW_CLIENT_API_KEY_OVERRIDE && typeof saved.apiKey === "string") {
        setApiKey(saved.apiKey);
      }
    }
  }, []);

  useEffect(() => {
    saveSettings({
      modelId,
      temperature,
      topK,
      maxOutputTokens,
      apiKey: ALLOW_CLIENT_API_KEY_OVERRIDE ? apiKey : "",
    });
  }, [modelId, temperature, topK, maxOutputTokens, apiKey]);

  useEffect(() => {
    const saved = loadThreads();

    if (saved && saved.threads.length > 0) {
      const orderedThreads = sortThreads(saved.threads);
      setThreads(orderedThreads);
      if (orderedThreads.some((thread) => thread.id === saved.activeThreadId)) {
        setActiveThreadId(saved.activeThreadId);
      } else {
        setActiveThreadId(orderedThreads[0].id);
      }
      setThreadsHydrated(true);
      return;
    }

    const initialThread = createThread();
    setThreads([initialThread]);
    setActiveThreadId(initialThread.id);
    setThreadsHydrated(true);
  }, []);

  useEffect(() => {
    if (!threadsHydrated || !activeThreadId) {
      return;
    }
    saveThreads({ activeThreadId, threads });
  }, [activeThreadId, threads, threadsHydrated]);

  useEffect(() => {
    if (!threadsHydrated || threads.length === 0) {
      return;
    }
    if (!threads.some((thread) => thread.id === activeThreadId)) {
      setActiveThreadId(threads[0].id);
    }
  }, [activeThreadId, threads, threadsHydrated]);

  useEffect(() => {
    let active = true;

    async function fetchStats() {
      try {
        const response = await fetch("/api/stats", { method: "GET" });
        if (!response.ok) {
          throw new Error(`Stats failed: ${response.status}`);
        }
        const json = (await response.json()) as StatsResponse;

        if (!active) {
          return;
        }

        setStats(json.dataset);
        if (Array.isArray(json.models) && json.models.length > 0) {
          setCatalog(json.models);
          setModelId((current) => coerceModelId(current, json.models));
        }
      } catch {
        if (active) {
          setCatalog(MODEL_SPECS);
          setModelId((current) => coerceModelId(current, MODEL_SPECS));
        }
      }
    }

    void fetchStats();

    return () => {
      active = false;
    };
  }, []);

  const groupedModels = useMemo(() => groupModelsByProvider(catalog), [catalog]);
  const selectedModel = useMemo(
    () => catalog.find((model) => model.id === modelId) ?? findModelSpec(modelId) ?? catalog[0] ?? MODEL_SPECS[0],
    [catalog, modelId]
  );
  const orderedThreads = useMemo(() => sortThreads(threads), [threads]);
  const activeThread = useMemo(
    () => orderedThreads.find((thread) => thread.id === activeThreadId) ?? null,
    [activeThreadId, orderedThreads]
  );
  const messages = activeThread?.messages ?? [];

  const threadMetrics = useMemo(() => {
    let inputTokens = 0;
    let outputTokens = 0;
    let totalTokens = 0;
    let totalCostUsd = 0;
    let userEstimatedTokens = 0;

    for (const message of messages) {
      if (message.role === "user") {
        userEstimatedTokens += message.estimatedTokens ?? estimateTokens(message.content);
      }

      if (message.usage) {
        inputTokens += message.usage.inputTokens;
        outputTokens += message.usage.outputTokens;
        totalTokens += message.usage.totalTokens;
      }

      if (message.cost) {
        totalCostUsd += message.cost.totalCostUsd;
      }
    }

    return {
      inputTokens,
      outputTokens,
      totalTokens,
      totalCostUsd,
      userEstimatedTokens,
    };
  }, [messages]);

  function updateThread(threadId: string, updater: (thread: UiThread) => UiThread) {
    setThreads((previous) => {
      let didChange = false;
      const next = previous.map((thread) => {
        if (thread.id !== threadId) {
          return thread;
        }
        didChange = true;
        return updater(thread);
      });
      if (!didChange) {
        return previous;
      }
      return sortThreads(next);
    });
  }

  async function handleSend() {
    const content = prompt.trim();
    if (!content || sending || !activeThreadId) {
      return;
    }

    setError(null);
    const requestThreadId = activeThreadId;

    const userMessage: UiMessage = {
      id: createId(),
      role: "user",
      content,
      createdAt: new Date().toISOString(),
      estimatedTokens: estimateTokens(content),
    };

    const nextMessages = [...messages, userMessage];
    updateThread(requestThreadId, (thread) => {
      const updatedMessages = [...thread.messages, userMessage];
      return {
        ...thread,
        messages: updatedMessages,
        title: deriveThreadTitle(updatedMessages),
        updatedAt: userMessage.createdAt,
      };
    });
    setPrompt("");
    setSending(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: nextMessages.map((message) => ({
            role: message.role,
            content: message.content,
          })),
          modelId,
          temperature,
          topK,
          maxOutputTokens,
          apiKey: ALLOW_CLIENT_API_KEY_OVERRIDE ? apiKey.trim() || undefined : undefined,
        }),
      });

      const json = (await response.json()) as ChatResponse & { error?: string };

      if (!response.ok) {
        throw new Error(json.error || `Chat request failed (${response.status})`);
      }

      const assistant = json.assistant;
      const assistantMessage: UiMessage = {
        id: createId(),
        role: "assistant",
        content: assistant.content,
        createdAt: new Date().toISOString(),
        usage: assistant.usage,
        cost: assistant.cost,
        modelId: assistant.modelId,
        provider: assistant.provider,
        citations: assistant.citations,
      };

      updateThread(requestThreadId, (thread) => {
        const updatedMessages = [...thread.messages, assistantMessage];
        return {
          ...thread,
          messages: updatedMessages,
          title: deriveThreadTitle(updatedMessages),
          updatedAt: assistantMessage.createdAt,
        };
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unexpected error while calling chat API.";
      setError(message);
      updateThread(requestThreadId, (thread) => {
        const updatedMessages = thread.messages.filter((messageItem) => messageItem.id !== userMessage.id);
        return {
          ...thread,
          messages: updatedMessages,
          title: deriveThreadTitle(updatedMessages),
          updatedAt: new Date().toISOString(),
        };
      });
      if (activeThreadIdRef.current === requestThreadId) {
        setPrompt(content);
      }
    } finally {
      setSending(false);
    }
  }

  function handleReset() {
    if (!activeThreadId) {
      return;
    }
    updateThread(activeThreadId, (thread) => ({
      ...thread,
      title: DEFAULT_THREAD_TITLE,
      messages: [],
      updatedAt: new Date().toISOString(),
    }));
    setError(null);
  }

  function handleCreateThread() {
    const thread = createThread();
    setThreads((previous) => sortThreads([thread, ...previous]));
    setActiveThreadId(thread.id);
    setPrompt("");
    setError(null);
  }

  function handleSelectThread(threadId: string) {
    if (threadId === activeThreadId) {
      return;
    }
    setActiveThreadId(threadId);
    setPrompt("");
    setError(null);
  }

  function handleDeleteThread(threadId: string) {
    if (threads.length <= 1) {
      const replacement = createThread();
      setThreads([replacement]);
      setActiveThreadId(replacement.id);
      setPrompt("");
      setError(null);
      return;
    }

    const remaining = sortThreads(threads.filter((thread) => thread.id !== threadId));
    setThreads(remaining);

    if (activeThreadId === threadId) {
      setActiveThreadId(remaining[0].id);
      setPrompt("");
      setError(null);
    }
  }

  return (
    <div className="lab-shell">
      <header className="lab-header panel">
        <div>
          <p className="eyebrow">RAG Research Protocol</p>
          <h1>Clever Support Research Lab</h1>
          <p className="subtitle">
            Evidence-driven retrieval and generation workspace with token, pricing, and dataset telemetry.
          </p>
        </div>
        <div className="header-stats">
          <div className="stat-pill">
            <span>Articles</span>
            <strong>{stats ? stats.articleCount.toLocaleString() : "-"}</strong>
          </div>
          <div className="stat-pill">
            <span>Chunks</span>
            <strong>{stats ? stats.chunkCount.toLocaleString() : "-"}</strong>
          </div>
          <div className="stat-pill">
            <span>Thread Cost</span>
            <strong>{usd(threadMetrics.totalCostUsd)}</strong>
          </div>
        </div>
      </header>

      <main className="workspace">
        <aside className="threads-column panel">
          <div className="threads-toolbar">
            <h2>Threads</h2>
            <button type="button" onClick={handleCreateThread} className="ghost-button" disabled={sending}>
              New Thread
            </button>
          </div>
          <p className="threads-note">
            {orderedThreads.length.toLocaleString()} saved locally in your browser localStorage.
          </p>

          <ul className="thread-list">
            {orderedThreads.map((thread) => {
              const lastMessage = thread.messages[thread.messages.length - 1];
              const preview = lastMessage ? summarizeText(lastMessage.content, 90) || "Empty message." : "No messages yet.";
              const active = thread.id === activeThreadId;

              return (
                <li key={thread.id} className={`thread-row ${active ? "active" : ""}`}>
                  <button type="button" className="thread-item" onClick={() => handleSelectThread(thread.id)}>
                    <span className="thread-title">{thread.title}</span>
                    <span className="thread-preview">{preview}</span>
                    <span className="thread-meta">
                      {thread.messages.length.toLocaleString()} msg · {formatThreadTimestamp(thread.updatedAt)}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="thread-delete"
                    onClick={() => handleDeleteThread(thread.id)}
                    disabled={sending || orderedThreads.length <= 1}
                    aria-label={`Delete thread ${thread.title}`}
                  >
                    Delete
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        <section className="chat-column panel">
          <div className="chat-toolbar">
            <p>
              Thread: <strong>{activeThread?.title ?? DEFAULT_THREAD_TITLE}</strong>
            </p>
            <p>
              Model: <strong>{selectedModel?.label ?? modelId}</strong>
            </p>
            <button type="button" onClick={handleReset} className="ghost-button" disabled={sending || !messages.length}>
              Clear Thread
            </button>
          </div>

          <div className="messages">
            {messages.length === 0 ? (
              <div className="empty-state">
                <h2>Ask anything about Clever support docs</h2>
                <p>
                  Example: "How do teachers request a paid app in Clever Library, and who gets notified?"
                </p>
              </div>
            ) : (
              messages.map((message, idx) => {
                const isAssistant = message.role === "assistant";
                const modelInfo = message.modelId ? findModelSpec(message.modelId) : undefined;

                return (
                  <article
                    key={message.id}
                    className={`message-card ${message.role}`}
                    style={{ animationDelay: `${idx * 0.04}s` }}
                  >
                    <header>
                      <span className="role-label">{isAssistant ? "Assistant" : "You"}</span>
                      <span className="timestamp">{new Date(message.createdAt).toLocaleTimeString()}</span>
                    </header>

                    {isAssistant ? (
                      <div className="message-text assistant-text">{renderAssistantMarkdown(message.content)}</div>
                    ) : (
                      <p className="message-text user-text">{message.content}</p>
                    )}

                    <footer className="message-meta">
                      {isAssistant && message.usage ? (
                        <>
                          <span>Input {message.usage.inputTokens.toLocaleString()} tok</span>
                          <span>Output {message.usage.outputTokens.toLocaleString()} tok</span>
                          <span>Total {message.usage.totalTokens.toLocaleString()} tok</span>
                          <span>{message.cost ? usd(message.cost.totalCostUsd) : "$0.000000"}</span>
                          {message.cost ? (
                            <span>
                              Rate {message.cost.inputRateUsdPerMillion}/{message.cost.outputRateUsdPerMillion} per 1M
                            </span>
                          ) : null}
                          <span>{modelInfo?.label ?? message.modelId}</span>
                        </>
                      ) : (
                        <span>~{(message.estimatedTokens ?? estimateTokens(message.content)).toLocaleString()} tok (est)</span>
                      )}
                    </footer>

                    {isAssistant && message.citations && message.citations.length > 0 ? (
                      <div className="citations">
                        <p className="citations-title">Sources used</p>
                        {message.citations.map((citation) => (
                          <details key={citation.chunkId}>
                            <summary>
                              [{citation.index}] {citation.title}
                            </summary>
                            <p>
                              <a href={citation.url} target="_blank" rel="noreferrer">
                                {citation.url}
                              </a>
                            </p>
                            <p className="snippet">{citation.snippet}</p>
                          </details>
                        ))}
                      </div>
                    ) : null}
                  </article>
                );
              })
            )}
            {sending ? <div className="thinking">Generating answer...</div> : null}
          </div>

          <div className="composer">
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Ask a question about Clever support..."
              rows={4}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void handleSend();
                }
              }}
            />
            <div className="composer-actions">
              {error ? <p className="error">{error}</p> : <p>Press Enter to send, Shift+Enter for newline.</p>}
              <button type="button" onClick={() => void handleSend()} disabled={sending || !prompt.trim()}>
                {sending ? "Sending..." : "Ask"}
              </button>
            </div>
          </div>
        </section>

        <aside className="settings-column panel">
          <h2>Research Controls</h2>

          <label>
            Model
            <select value={modelId} onChange={(event) => setModelId(event.target.value)}>
              {Object.entries(groupedModels).map(([provider, providerModels]) => (
                <optgroup key={provider} label={provider.toUpperCase()}>
                  {providerModels.map((model) => (
                    <option value={model.id} key={model.id}>
                      {model.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>

          {selectedModel ? (
            <div className="model-note">
              <p>{selectedModel.description}</p>
              <p>
                Input ${selectedModel.inputPerMillionUsd}/1M tok, output ${selectedModel.outputPerMillionUsd}/1M tok
              </p>
              {typeof selectedModel.longContextThresholdTokens === "number" &&
              typeof selectedModel.longContextInputPerMillionUsd === "number" &&
              typeof selectedModel.longContextOutputPerMillionUsd === "number" ? (
                <p>
                  Over {selectedModel.longContextThresholdTokens.toLocaleString()} prompt tok: input $
                  {selectedModel.longContextInputPerMillionUsd}/1M, output $
                  {selectedModel.longContextOutputPerMillionUsd}/1M
                </p>
              ) : null}
              {selectedModel.pricingNotes ? <p>{selectedModel.pricingNotes}</p> : null}
              <p className="muted">Pricing source: {selectedModel.pricingSource}</p>
            </div>
          ) : null}

          {ALLOW_CLIENT_API_KEY_OVERRIDE ? (
            <label>
              API key override (optional)
              <input
                type="password"
                value={apiKey}
                placeholder="sk-... / sk-ant-... / AIza..."
                onChange={(event) => setApiKey(event.target.value)}
              />
            </label>
          ) : (
            <p className="muted">Provider keys are configured server-side.</p>
          )}

          <label>
            Retrieval chunks ({topK})
            <input
              type="range"
              min={2}
              max={10}
              value={topK}
              onChange={(event) => setTopK(Number(event.target.value))}
            />
          </label>

          <label>
            Temperature ({temperature.toFixed(2)})
            <input
              type="range"
              min={0}
              max={1.2}
              step={0.05}
              value={temperature}
              onChange={(event) => setTemperature(Number(event.target.value))}
            />
          </label>

          <label>
            Max output tokens
            <input
              type="number"
              min={256}
              max={4096}
              value={maxOutputTokens}
              onChange={(event) => setMaxOutputTokens(Number(event.target.value))}
            />
          </label>

          <div className="thread-metrics">
            <h3>Thread usage</h3>
            <p>Prompt tokens (billed): {threadMetrics.inputTokens.toLocaleString()}</p>
            <p>Completion tokens (billed): {threadMetrics.outputTokens.toLocaleString()}</p>
            <p>Total billed tokens: {threadMetrics.totalTokens.toLocaleString()}</p>
            <p>User tokens (estimated): {threadMetrics.userEstimatedTokens.toLocaleString()}</p>
            <p className="cost">Estimated cost: {usd(threadMetrics.totalCostUsd)}</p>
          </div>

          {stats ? (
            <div className="dataset-note">
              <h3>Dataset</h3>
              <p>{stats.articleCount.toLocaleString()} articles loaded.</p>
              <p>{stats.chunkCount.toLocaleString()} chunks available for retrieval.</p>
              <p className="muted">Source file: {stats.chunksPath}</p>
            </div>
          ) : (
            <p className="muted">Loading dataset stats...</p>
          )}
        </aside>
      </main>
    </div>
  );
}

function groupModelsByProvider(models: ModelSpec[]): Record<string, ModelSpec[]> {
  const grouped: Record<string, ModelSpec[]> = {};
  for (const model of models) {
    if (!grouped[model.provider]) {
      grouped[model.provider] = [];
    }
    grouped[model.provider].push(model);
  }
  return grouped;
}

function coerceModelId(candidate: string | undefined, catalog: ModelSpec[]): string {
  if (typeof candidate === "string" && catalog.some((spec) => spec.id === candidate)) {
    return candidate;
  }

  if (catalog.some((spec) => spec.id === DEFAULT_MODEL_ID)) {
    return DEFAULT_MODEL_ID;
  }

  return catalog[0]?.id ?? DEFAULT_MODEL_ID;
}

function createId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function loadSettings(): Partial<{
  modelId: string;
  temperature: number;
  topK: number;
  maxOutputTokens: number;
  apiKey: string;
}> | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as Partial<{
      modelId: string;
      temperature: number;
      topK: number;
      maxOutputTokens: number;
      apiKey: string;
    }>;
  } catch {
    return null;
  }
}

function saveSettings(settings: {
  modelId: string;
  temperature: number;
  topK: number;
  maxOutputTokens: number;
  apiKey: string;
}): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
}

function createThread(): UiThread {
  const now = new Date().toISOString();
  return {
    id: createId(),
    title: DEFAULT_THREAD_TITLE,
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

function deriveThreadTitle(messages: UiMessage[]): string {
  const firstUserMessage = messages.find((message) => message.role === "user" && message.content.trim().length > 0);
  if (firstUserMessage) {
    return summarizeText(firstUserMessage.content, MAX_THREAD_TITLE_LENGTH);
  }

  const firstAnyMessage = messages.find((message) => message.content.trim().length > 0);
  if (firstAnyMessage) {
    return summarizeText(firstAnyMessage.content, MAX_THREAD_TITLE_LENGTH);
  }

  return DEFAULT_THREAD_TITLE;
}

function summarizeText(text: string, maxLength = 90): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  if (maxLength <= 3) {
    return normalized.slice(0, maxLength);
  }
  return `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
}

function formatThreadTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown time";
  }
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function sortThreads(threads: UiThread[]): UiThread[] {
  return [...threads].sort((a, b) => toTimestamp(b.updatedAt) - toTimestamp(a.updatedAt));
}

function toTimestamp(value: string): number {
  const timestamp = Date.parse(value);
  if (Number.isFinite(timestamp)) {
    return timestamp;
  }
  return 0;
}

function loadThreads(): ThreadStore | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(THREADS_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || !Array.isArray(parsed.threads)) {
      return null;
    }

    const threads = parsed.threads.map(parseThread).filter((thread): thread is UiThread => thread !== null);
    if (threads.length === 0) {
      return null;
    }

    const activeThreadId =
      typeof parsed.activeThreadId === "string" && threads.some((thread) => thread.id === parsed.activeThreadId)
        ? parsed.activeThreadId
        : threads[0].id;

    return {
      activeThreadId,
      threads: sortThreads(threads),
    };
  } catch {
    return null;
  }
}

function parseThread(value: unknown): UiThread | null {
  if (!isRecord(value) || typeof value.id !== "string") {
    return null;
  }

  const messages = Array.isArray(value.messages)
    ? value.messages.map(parseMessage).filter((message): message is UiMessage => message !== null)
    : [];

  const titleSource = typeof value.title === "string" ? value.title : deriveThreadTitle(messages);
  const title = summarizeText(titleSource, MAX_THREAD_TITLE_LENGTH) || DEFAULT_THREAD_TITLE;

  const createdAt = typeof value.createdAt === "string" ? value.createdAt : new Date().toISOString();
  const updatedAt = typeof value.updatedAt === "string" ? value.updatedAt : createdAt;

  return {
    id: value.id,
    title,
    createdAt,
    updatedAt,
    messages,
  };
}

function parseMessage(value: unknown): UiMessage | null {
  if (!isRecord(value)) {
    return null;
  }

  const role = value.role;
  if (!isUiRole(role)) {
    return null;
  }

  if (typeof value.id !== "string" || typeof value.content !== "string" || typeof value.createdAt !== "string") {
    return null;
  }

  const message: UiMessage = {
    id: value.id,
    role,
    content: value.content,
    createdAt: value.createdAt,
  };

  if (typeof value.estimatedTokens === "number") {
    message.estimatedTokens = value.estimatedTokens;
  }
  if (typeof value.modelId === "string") {
    message.modelId = value.modelId;
  }
  if (typeof value.provider === "string") {
    message.provider = value.provider;
  }
  if (Array.isArray(value.citations)) {
    message.citations = value.citations.map(parseCitation).filter((citation): citation is Citation => citation !== null);
  }

  const usage = parseUsageMetrics(value.usage);
  if (usage) {
    message.usage = usage;
  }

  const cost = parseCostMetrics(value.cost);
  if (cost) {
    message.cost = cost;
  }

  return message;
}

function saveThreads(store: ThreadStore): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(
    THREADS_STORAGE_KEY,
    JSON.stringify({
      activeThreadId: store.activeThreadId,
      threads: sortThreads(store.threads),
    })
  );
}

function isUiRole(value: unknown): value is UiRole {
  return value === "assistant" || value === "user";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseCitation(value: unknown): Citation | null {
  if (!isRecord(value)) {
    return null;
  }
  if (
    typeof value.index !== "number" ||
    typeof value.title !== "string" ||
    typeof value.url !== "string" ||
    typeof value.chunkId !== "string" ||
    (value.section !== null && typeof value.section !== "string") ||
    typeof value.score !== "number" ||
    typeof value.snippet !== "string"
  ) {
    return null;
  }
  return {
    index: value.index,
    title: value.title,
    url: value.url,
    chunkId: value.chunkId,
    section: value.section,
    score: value.score,
    snippet: value.snippet,
  };
}

function parseUsageMetrics(value: unknown): UsageMetrics | null {
  if (!isRecord(value)) {
    return null;
  }
  if (
    typeof value.inputTokens !== "number" ||
    typeof value.outputTokens !== "number" ||
    typeof value.totalTokens !== "number"
  ) {
    return null;
  }
  return {
    inputTokens: value.inputTokens,
    outputTokens: value.outputTokens,
    totalTokens: value.totalTokens,
  };
}

function parseCostMetrics(value: unknown): CostMetrics | null {
  if (!isRecord(value)) {
    return null;
  }
  if (
    typeof value.inputCostUsd !== "number" ||
    typeof value.outputCostUsd !== "number" ||
    typeof value.totalCostUsd !== "number" ||
    typeof value.inputRateUsdPerMillion !== "number" ||
    typeof value.outputRateUsdPerMillion !== "number" ||
    (value.pricingTier !== "standard" && value.pricingTier !== "long-context" && value.pricingTier !== "unknown") ||
    typeof value.hasPricing !== "boolean"
  ) {
    return null;
  }
  return {
    inputCostUsd: value.inputCostUsd,
    outputCostUsd: value.outputCostUsd,
    totalCostUsd: value.totalCostUsd,
    inputRateUsdPerMillion: value.inputRateUsdPerMillion,
    outputRateUsdPerMillion: value.outputRateUsdPerMillion,
    pricingTier: value.pricingTier,
    hasPricing: value.hasPricing,
  };
}

type MarkdownBlock =
  | {
      type: "paragraph";
      text: string;
    }
  | {
      type: "ul" | "ol";
      items: string[];
    };

function renderAssistantMarkdown(content: string): ReactNode {
  const blocks = parseMarkdownBlocks(content);
  if (blocks.length === 0) {
    return content;
  }

  return blocks.map((block, blockIndex) => {
    if (block.type === "paragraph") {
      return <p key={`p-${blockIndex}`}>{renderInlineMarkdown(block.text, `p-${blockIndex}`)}</p>;
    }

    if (block.type === "ul") {
      return (
        <ul key={`ul-${blockIndex}`}>
          {block.items.map((item, itemIndex) => (
            <li key={`ul-${blockIndex}-${itemIndex}`}>{renderInlineMarkdown(item, `ul-${blockIndex}-${itemIndex}`)}</li>
          ))}
        </ul>
      );
    }

    return (
      <ol key={`ol-${blockIndex}`}>
        {block.items.map((item, itemIndex) => (
          <li key={`ol-${blockIndex}-${itemIndex}`}>{renderInlineMarkdown(item, `ol-${blockIndex}-${itemIndex}`)}</li>
        ))}
      </ol>
    );
  });
}

function parseMarkdownBlocks(content: string): MarkdownBlock[] {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];

  let paragraphLines: string[] = [];
  let listType: "ul" | "ol" | null = null;
  let listItems: string[] = [];

  const flushParagraph = () => {
    if (paragraphLines.length === 0) {
      return;
    }

    const text = paragraphLines.join(" ").replace(/\s+/g, " ").trim();
    if (text.length > 0) {
      blocks.push({ type: "paragraph", text });
    }
    paragraphLines = [];
  };

  const flushList = () => {
    if (!listType || listItems.length === 0) {
      listType = null;
      listItems = [];
      return;
    }

    blocks.push({ type: listType, items: listItems });
    listType = null;
    listItems = [];
  };

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    const unorderedMatch = trimmed.match(/^[-*+]\s+(.*)$/);
    const orderedMatch = trimmed.match(/^\d+\.\s+(.*)$/);

    if (trimmed.length === 0) {
      flushParagraph();
      flushList();
      continue;
    }

    if (unorderedMatch) {
      flushParagraph();
      if (listType && listType !== "ul") {
        flushList();
      }
      listType = "ul";
      listItems.push(unorderedMatch[1]);
      continue;
    }

    if (orderedMatch) {
      flushParagraph();
      if (listType && listType !== "ol") {
        flushList();
      }
      listType = "ol";
      listItems.push(orderedMatch[1]);
      continue;
    }

    if (listType && /^\s{2,}\S/.test(rawLine) && listItems.length > 0) {
      const index = listItems.length - 1;
      listItems[index] = `${listItems[index]} ${trimmed}`;
      continue;
    }

    if (listType) {
      flushList();
    }

    paragraphLines.push(trimmed);
  }

  flushParagraph();
  flushList();

  return blocks;
}

function renderInlineMarkdown(text: string, keyPrefix: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const pattern =
    /(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\*\*([^*\n]+)\*\*|`([^`\n]+)`|\*([^\s*](?:[^*]*[^\s*])?)\*|(https?:\/\/[^\s<>()]+[^\s<>().,!?;:]))/g;
  let cursor = 0;
  let match = pattern.exec(text);
  let index = 0;

  while (match) {
    if (match.index > cursor) {
      parts.push(text.slice(cursor, match.index));
    }

    if (match[3]) {
      const safeHref = toSafeHref(match[3]);
      const label = match[2] ?? match[1];

      if (safeHref) {
        parts.push(
          <a key={`${keyPrefix}-link-${index}`} href={safeHref} target="_blank" rel="noreferrer">
            {label}
          </a>
        );
      } else {
        parts.push(match[1]);
      }
    } else if (match[4]) {
      parts.push(<strong key={`${keyPrefix}-strong-${index}`}>{match[4]}</strong>);
    } else if (match[5]) {
      parts.push(<code key={`${keyPrefix}-code-${index}`}>{match[5]}</code>);
    } else if (match[6]) {
      parts.push(<em key={`${keyPrefix}-em-${index}`}>{match[6]}</em>);
    } else if (match[7]) {
      const safeHref = toSafeHref(match[7]);
      if (safeHref) {
        parts.push(
          <a key={`${keyPrefix}-url-${index}`} href={safeHref} target="_blank" rel="noreferrer">
            {match[7]}
          </a>
        );
      } else {
        parts.push(match[7]);
      }
    } else {
      parts.push(match[1]);
    }

    cursor = pattern.lastIndex;
    index += 1;
    match = pattern.exec(text);
  }

  if (cursor < text.length) {
    parts.push(text.slice(cursor));
  }

  return parts;
}

function toSafeHref(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.toString();
    }
    return null;
  } catch {
    return null;
  }
}
