"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AssistantMessageText } from "@/components/assistant-message-text";
import { DEFAULT_MODEL_ID, MODEL_SPECS, type ModelSpec } from "@/lib/models";

interface MeResponse {
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

interface ThreadListResponse {
  items: ThreadListItem[];
  nextCursor: string | null;
}

interface ThreadListItem {
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

interface ThreadDetailResponse {
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

interface ThreadMessage {
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

interface Citation {
  id: string;
  chunkId: string;
  docId: string | null;
  url: string;
  title: string;
  section: string | null;
  score: number;
  snippet: string;
}

interface ChatResponse {
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

type ApiKeyProvider = "openai" | "anthropic" | "gemini";

interface UserApiKeyItem {
  id: string;
  provider: ApiKeyProvider;
  label: string;
  keyPreview: string;
  createdAt: string;
  updatedAt: string;
}

interface UserApiKeysResponse {
  items: UserApiKeyItem[];
}

interface StatsResponse {
  dataset: {
    articleCount: number;
    chunkCount: number;
    chunksPath: string;
    sourceDocCounts?: Record<string, number>;
    sourceChunkCounts?: Record<string, number>;
  };
  models: ModelSpec[];
}

const MAX_PREVIEW_LENGTH = 150;
type RetrievalSource = "support" | "dev";
const SOURCE_OPTIONS: Array<{ id: RetrievalSource; label: string }> = [
  { id: "support", label: "Support Docs" },
  { id: "dev", label: "Dev Docs" },
];

export function RagLab() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [scope, setScope] = useState<"all" | "mine">("all");
  const [threads, setThreads] = useState<ThreadListItem[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [threadDetail, setThreadDetail] = useState<ThreadDetailResponse | null>(null);
  const [loadingThreads, setLoadingThreads] = useState(true);
  const [loadingThreadDetail, setLoadingThreadDetail] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submittingFeedbackMessageId, setSubmittingFeedbackMessageId] = useState<string | null>(null);
  const [submittingThreadFeedback, setSubmittingThreadFeedback] = useState(false);
  const [modelId, setModelId] = useState(DEFAULT_MODEL_ID);
  const [sources, setSources] = useState<RetrievalSource[]>(["support", "dev"]);
  const [topK, setTopK] = useState(6);
  const [temperature, setTemperature] = useState(0.2);
  const [maxOutputTokens, setMaxOutputTokens] = useState(1200);
  const [modelCatalog, setModelCatalog] = useState<ModelSpec[]>(MODEL_SPECS);
  const [showAllModels, setShowAllModels] = useState(false);
  const [datasetStats, setDatasetStats] = useState<StatsResponse["dataset"] | null>(null);
  const [keyMode, setKeyMode] = useState<"house" | "personal">("house");
  const [userApiKeys, setUserApiKeys] = useState<UserApiKeyItem[]>([]);
  const [selectedUserApiKeyId, setSelectedUserApiKeyId] = useState<string>("");
  const [newApiKeyLabel, setNewApiKeyLabel] = useState("");
  const [newApiKeyProvider, setNewApiKeyProvider] = useState<ApiKeyProvider>("openai");
  const [newApiKeyValue, setNewApiKeyValue] = useState("");
  const [savingApiKey, setSavingApiKey] = useState(false);
  const [deletingApiKeyId, setDeletingApiKeyId] = useState<string | null>(null);

  const selectedModel = useMemo(
    () => modelCatalog.find((model) => model.id === modelId) ?? modelCatalog[0] ?? MODEL_SPECS[0],
    [modelCatalog, modelId]
  );
  const sourceLabel = useMemo(() => {
    if (sources.length === 0) {
      return "None";
    }
    if (sources.length === SOURCE_OPTIONS.length) {
      return "Support + Dev";
    }
    return SOURCE_OPTIONS.find((option) => option.id === sources[0])?.label ?? sources[0];
  }, [sources]);
  const accountLabel = useMemo(() => {
    const name = me?.user.name?.trim();
    if (name) {
      return name.split(/\s+/)[0];
    }
    const email = me?.user.email?.trim();
    if (!email) {
      return "Account";
    }
    return email.split("@")[0].slice(0, 18);
  }, [me?.user.email, me?.user.name]);
  const accountInitial = accountLabel.charAt(0).toUpperCase();
  const modelProvider = useMemo(() => {
    const separator = modelId.indexOf(":");
    return separator > 0 ? modelId.slice(0, separator) : "";
  }, [modelId]);
  const compatiblePersonalKeys = useMemo(
    () => userApiKeys.filter((key) => key.provider === modelProvider),
    [modelProvider, userApiKeys]
  );
  const visibleModelCatalog = useMemo(
    () => buildVisibleModelCatalog(modelCatalog, showAllModels, modelId),
    [modelCatalog, showAllModels, modelId]
  );

  useEffect(() => {
    void loadMe();
    void loadStats();
    void loadUserApiKeys();
  }, []);

  useEffect(() => {
    void loadThreads(scope);
  }, [scope]);

  useEffect(() => {
    if (!activeThreadId) {
      setThreadDetail(null);
      return;
    }

    void loadThread(activeThreadId);
  }, [activeThreadId]);

  useEffect(() => {
    if (keyMode !== "personal") {
      return;
    }

    if (!selectedUserApiKeyId || compatiblePersonalKeys.some((key) => key.id === selectedUserApiKeyId)) {
      return;
    }

    setSelectedUserApiKeyId(compatiblePersonalKeys[0]?.id ?? "");
  }, [keyMode, selectedUserApiKeyId, compatiblePersonalKeys]);

  async function loadMe() {
    const response = await fetch("/api/me", { method: "GET" });
    if (!response.ok) {
      if (response.status === 401) {
        window.location.href = "/signin";
        return;
      }
      throw new Error(`Failed to load profile (${response.status})`);
    }

    const payload = (await response.json()) as MeResponse;
    setMe(payload);
  }

  async function loadStats() {
    try {
      const response = await fetch("/api/stats", { method: "GET" });
      if (!response.ok) {
        return;
      }
      const payload = (await response.json()) as StatsResponse;
      if (Array.isArray(payload.models) && payload.models.length > 0) {
        setModelCatalog(payload.models);
        setModelId((current) => {
          if (payload.models.some((model) => model.id === current)) {
            return current;
          }
          if (payload.models.some((model) => model.id === DEFAULT_MODEL_ID)) {
            return DEFAULT_MODEL_ID;
          }
          return payload.models[0].id;
        });
      }
      setDatasetStats(payload.dataset);
    } catch {
      // Non-critical. Keep local model presets.
    }
  }

  async function loadUserApiKeys() {
    try {
      const response = await fetch("/api/me/keys", { method: "GET" });
      if (!response.ok) {
        throw new Error(`Failed to load API keys (${response.status})`);
      }
      const payload = (await response.json()) as UserApiKeysResponse;
      setUserApiKeys(payload.items);
      setSelectedUserApiKeyId((current) => {
        if (current && payload.items.some((item) => item.id === current)) {
          return current;
        }
        return payload.items[0]?.id ?? "";
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load personal API keys.");
    }
  }

  async function handleSaveApiKey() {
    if (savingApiKey) {
      return;
    }

    const label = newApiKeyLabel.trim();
    const apiKey = newApiKeyValue.trim();
    if (!label || !apiKey) {
      setError("Provide both a key label and API key value.");
      return;
    }

    try {
      setSavingApiKey(true);
      setError(null);
      const response = await fetch("/api/me/keys", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          provider: newApiKeyProvider,
          label,
          apiKey,
        }),
      });

      const payload = (await response.json()) as { error?: string; key?: UserApiKeyItem };
      if (!response.ok) {
        throw new Error(payload.error || `Failed to save API key (${response.status})`);
      }

      setNewApiKeyLabel("");
      setNewApiKeyValue("");
      await loadUserApiKeys();
      setKeyMode("personal");
      if (payload.key?.id) {
        setSelectedUserApiKeyId(payload.key.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save API key.");
    } finally {
      setSavingApiKey(false);
    }
  }

  async function handleDeleteApiKey(id: string) {
    if (deletingApiKeyId) {
      return;
    }

    try {
      setDeletingApiKeyId(id);
      setError(null);
      const response = await fetch(`/api/me/keys/${id}`, {
        method: "DELETE",
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || `Failed to delete API key (${response.status})`);
      }
      await loadUserApiKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to delete API key.");
    } finally {
      setDeletingApiKeyId(null);
    }
  }

  async function loadThreads(nextScope: "all" | "mine") {
    try {
      setLoadingThreads(true);
      const response = await fetch(`/api/threads?scope=${nextScope}`, { method: "GET" });
      if (!response.ok) {
        throw new Error(`Failed to load threads (${response.status})`);
      }

      const payload = (await response.json()) as ThreadListResponse;
      setThreads(payload.items);

      if (payload.items.length === 0) {
        setActiveThreadId(null);
        return;
      }

      setActiveThreadId((current) => {
        if (current && payload.items.some((thread) => thread.id === current)) {
          return current;
        }
        return payload.items[0].id;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load threads.");
    } finally {
      setLoadingThreads(false);
    }
  }

  async function loadThread(threadId: string) {
    try {
      setLoadingThreadDetail(true);
      const response = await fetch(`/api/threads/${threadId}`, { method: "GET" });
      if (!response.ok) {
        throw new Error(`Failed to load thread (${response.status})`);
      }
      const payload = (await response.json()) as ThreadDetailResponse;
      setThreadDetail(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load thread details.");
    } finally {
      setLoadingThreadDetail(false);
    }
  }

  async function handleCreateThread() {
    try {
      const threadId = await createThread();
      await loadThreads(scope);
      setActiveThreadId(threadId);
      setPrompt("");
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create thread.");
    }
  }

  async function createThread() {
    const response = await fetch("/api/threads", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        visibility: "org",
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to create thread (${response.status})`);
    }

    const payload = (await response.json()) as { thread: { id: string } };
    return payload.thread.id;
  }

  async function handleSend() {
    const content = prompt.trim();
    if (!content || sending) {
      return;
    }
    if (sources.length === 0) {
      setError("Select at least one source for retrieval context.");
      return;
    }
    if (keyMode === "personal") {
      if (!selectedUserApiKeyId) {
        setError("Select a compatible personal API key for this model.");
        return;
      }
      if (!compatiblePersonalKeys.some((key) => key.id === selectedUserApiKeyId)) {
        setError("Selected personal key does not match the current model provider.");
        return;
      }
    }

    setSending(true);
    setError(null);

    try {
      const threadId = activeThreadId ?? (await createThread());
      if (!activeThreadId) {
        setActiveThreadId(threadId);
      }

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          threadId,
          content,
          sources,
          modelId,
          topK,
          temperature,
          maxOutputTokens,
          userApiKeyId: keyMode === "personal" ? selectedUserApiKeyId : null,
        }),
      });

      const payload = (await response.json()) as ChatResponse & {
        error?: string;
        code?: string;
        remainingBalanceCents?: number;
      };

      if (!response.ok) {
        if (response.status === 402 || payload.code === "insufficient_balance") {
          const remaining = typeof payload.remainingBalanceCents === "number" ? payload.remainingBalanceCents : null;
          setError(
            remaining !== null
              ? `Insufficient balance. Remaining credit: ${formatUsdFromCents(remaining)}.`
              : payload.error || "Insufficient balance."
          );
        } else {
          throw new Error(payload.error || `Failed to send message (${response.status})`);
        }
      } else {
        setPrompt("");
      }

      await Promise.all([loadThread(threadId), loadThreads(scope), loadMe()]);
      if (!activeThreadId) {
        setActiveThreadId(threadId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message.");
    } finally {
      setSending(false);
    }
  }

  async function submitMessageFeedback(messageId: string, rating: number, comment?: string) {
    if (!activeThreadId) {
      return;
    }

    try {
      setSubmittingFeedbackMessageId(messageId);
      const response = await fetch(`/api/messages/${messageId}/feedback`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          rating,
          comment,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error || `Failed to save feedback (${response.status})`);
      }

      await loadThread(activeThreadId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save feedback.");
    } finally {
      setSubmittingFeedbackMessageId(null);
    }
  }

  function toggleSource(source: RetrievalSource) {
    setSources((current) => {
      const next = current.includes(source) ? current.filter((item) => item !== source) : [...current, source];
      return SOURCE_OPTIONS.map((item) => item.id).filter((item) => next.includes(item));
    });
  }

  async function submitThreadFeedback(rating: number, comment?: string) {
    if (!activeThreadId) {
      return;
    }

    try {
      setSubmittingThreadFeedback(true);
      const response = await fetch(`/api/threads/${activeThreadId}/feedback`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          rating,
          comment,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error || `Failed to save thread feedback (${response.status})`);
      }

      await loadThread(activeThreadId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save thread feedback.");
    } finally {
      setSubmittingThreadFeedback(false);
    }
  }

  return (
    <div className="lab-shell">
      <header className="lab-header panel">
        <div>
          <p className="eyebrow">RAG Workspace</p>
          <h1>Clever Support Chat</h1>
          <p className="subtitle">Shared, persisted threads with budget and feedback controls.</p>
        </div>

        <div className="header-stats">
          <div className="stat-pill">
            <span>Role</span>
            <strong>{me?.user.role ?? "-"}</strong>
          </div>
          <div className="stat-pill">
            <span>Credit</span>
            <strong>{formatUsdFromCents(me?.wallet.balanceCents ?? 0)}</strong>
          </div>
          <Link href="/docs" className="header-link">
            Browse Docs
          </Link>
          <Link href="/models" className="header-link">
            Model Guide
          </Link>
          <Link href="/profile" className="header-account" aria-label="Open profile">
            <span className="header-account-avatar" aria-hidden="true">
              {accountInitial}
            </span>
            <span className="header-account-name">{accountLabel}</span>
          </Link>
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

          <div className="scope-toggle" role="tablist" aria-label="Thread scope">
            <button
              type="button"
              className={scope === "all" ? "active" : ""}
              onClick={() => setScope("all")}
              disabled={loadingThreads}
            >
              All
            </button>
            <button
              type="button"
              className={scope === "mine" ? "active" : ""}
              onClick={() => setScope("mine")}
              disabled={loadingThreads}
            >
              Mine
            </button>
          </div>

          <ul className="thread-list">
            {loadingThreads ? (
              <li className="thread-row">
                <p className="muted">Loading threads...</p>
              </li>
            ) : threads.length === 0 ? (
              <li className="thread-row">
                <p className="muted">No threads yet. Start with "New Thread".</p>
              </li>
            ) : (
              threads.map((thread) => {
                const active = thread.id === activeThreadId;
                return (
                  <li key={thread.id} className={`thread-row ${active ? "active" : ""}`}>
                    <button
                      type="button"
                      className="thread-item"
                      onClick={() => {
                        setActiveThreadId(thread.id);
                        setError(null);
                      }}
                    >
                      <span className="thread-title">{thread.title}</span>
                      <span className="thread-preview">
                        {thread.lastMessage?.contentPreview?.slice(0, MAX_PREVIEW_LENGTH) || "No messages yet."}
                      </span>
                      <span className="thread-meta">
                        {thread.messageCount.toLocaleString()} msg · {formatThreadTimestamp(thread.updatedAt)}
                      </span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>

          <div className="nav-links">
            <a href="/api/auth/signout?callbackUrl=/signin" className="ghost-button">
              Sign out
            </a>
            {me?.user.role === "admin" ? (
              <a href="/admin" className="ghost-button">
                Admin
              </a>
            ) : null}
          </div>
        </aside>

        <section className="chat-column panel">
          <div className="chat-toolbar">
            <p>
              Thread: <strong>{threadDetail?.thread.title ?? "No thread selected"}</strong>
            </p>
            <p>
              Model: <strong>{selectedModel?.label ?? modelId}</strong>
            </p>
            <p>
              Sources: <strong>{sourceLabel}</strong>
            </p>
          </div>

          <div className="messages">
            {loadingThreadDetail ? (
              <div className="empty-state">
                <p>Loading thread messages...</p>
              </div>
            ) : !threadDetail ? (
              <div className="empty-state">
                <h2>No thread selected</h2>
                <p>Create or select a thread to start chatting.</p>
              </div>
            ) : threadDetail.messages.length === 0 ? (
              <div className="empty-state">
                <h2>Ask about Clever support docs</h2>
                <p>Threads are visible org-wide by default unless created as private.</p>
              </div>
            ) : (
              threadDetail.messages.map((message) => (
                <article key={message.id} className={`message-card ${message.role}`}>
                  <header>
                    <span className="role-label">
                      {message.role === "assistant" ? "Assistant" : message.role === "user" ? "You" : "System"}
                    </span>
                    <span className="timestamp">{new Date(message.createdAt).toLocaleString()}</span>
                  </header>

                  {message.role === "assistant" ? (
                    <AssistantMessageText content={message.content} hasStructuredCitations={message.citations.length > 0} />
                  ) : (
                    <p className="message-text user-text">{message.content}</p>
                  )}

                  <footer className="message-meta">
                    {message.modelId ? <span>{message.modelId}</span> : null}
                    {message.provider ? <span>{message.provider}</span> : null}
                    {message.usage?.inputTokens ? <span>Input {message.usage.inputTokens.toLocaleString()} tok</span> : null}
                    {message.usage?.outputTokens ? <span>Output {message.usage.outputTokens.toLocaleString()} tok</span> : null}
                    {message.costCents > 0 ? <span>{formatUsdFromCents(message.costCents)}</span> : null}
                    {message.feedback.count > 0 ? (
                      <span>
                        Rating {message.feedback.averageRating?.toFixed(2) ?? "-"} ({message.feedback.count})
                      </span>
                    ) : null}
                  </footer>

                  {message.citations.length > 0 ? (
                    <details className="citations">
                      <summary>Sources ({message.citations.length})</summary>
                      {message.citations.map((citation) => (
                        <div key={citation.id} className="citation-row">
                          <p className="citations-title">
                            <a href={citation.url} target="_blank" rel="noreferrer">
                              {citation.title}
                            </a>
                          </p>
                          <p className="snippet">{citation.snippet}</p>
                        </div>
                      ))}
                    </details>
                  ) : null}

                  {message.role === "assistant" ? (
                    <MessageFeedbackBox
                      message={message}
                      disabled={submittingFeedbackMessageId === message.id}
                      onSubmit={(rating, comment) => submitMessageFeedback(message.id, rating, comment)}
                    />
                  ) : null}
                </article>
              ))
            )}
          </div>

          <div className="composer">
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Ask about Clever support flows, policies, or setup steps..."
              disabled={sending}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.preventDefault();
                  void handleSend();
                }
              }}
            />

            {error ? <p className="error">{error}</p> : null}

            <div className="composer-actions">
              <p>{activeThreadId ? "Cmd/Ctrl + Enter to send" : "Cmd/Ctrl + Enter to send (creates a thread)"}</p>
              <button type="button" onClick={() => void handleSend()} disabled={sending || !prompt.trim()}>
                {sending ? "Sending..." : "Send"}
              </button>
            </div>
          </div>
        </section>

        <aside className="settings-column panel">
          <h2>Session</h2>

          <div className="settings-field">
            <p className="settings-field-label">Model</p>
            <label className="model-filter-toggle">
              <input
                type="checkbox"
                checked={showAllModels}
                onChange={(event) => setShowAllModels(event.target.checked)}
              />
              <span>Show all available models</span>
            </label>
            <select value={modelId} onChange={(event) => setModelId(event.target.value)}>
              {visibleModelCatalog.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label}
                </option>
              ))}
            </select>
          </div>

          <div className="settings-field">
            <label className="model-filter-toggle">
              <input
                type="checkbox"
                checked={keyMode === "personal"}
                onChange={(event) => {
                  const usePersonal = event.target.checked;
                  setKeyMode(usePersonal ? "personal" : "house");
                  if (usePersonal && !selectedUserApiKeyId) {
                    setSelectedUserApiKeyId(compatiblePersonalKeys[0]?.id ?? "");
                  }
                }}
              />
              <span>Use personal API key (no app billing)</span>
            </label>
          </div>

          {keyMode === "personal" ? (
            <>
              <div className="settings-field">
                <p className="settings-field-label">Personal key for this model</p>
                <select value={selectedUserApiKeyId} onChange={(event) => setSelectedUserApiKeyId(event.target.value)}>
                  {compatiblePersonalKeys.length === 0 ? (
                    <option value="">No compatible personal key saved</option>
                  ) : (
                    compatiblePersonalKeys.map((key) => (
                      <option key={key.id} value={key.id}>
                        {key.label} ({key.keyPreview})
                      </option>
                    ))
                  )}
                </select>
                <p className="muted">
                  Model provider: <strong>{modelProvider || "unknown"}</strong>
                </p>
              </div>

              <div className="dataset-note">
                <h3>Personal API keys</h3>
                <p>Saved: {userApiKeys.length}</p>
                {userApiKeys.length === 0 ? (
                  <p className="muted">No personal keys saved yet.</p>
                ) : (
                  userApiKeys.map((item) => (
                    <p key={item.id}>
                      {item.label} ({item.provider}) {item.keyPreview}{" "}
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() => void handleDeleteApiKey(item.id)}
                        disabled={deletingApiKeyId === item.id}
                      >
                        {deletingApiKeyId === item.id ? "Deleting..." : "Delete"}
                      </button>
                    </p>
                  ))
                )}
                <select
                  value={newApiKeyProvider}
                  onChange={(event) => setNewApiKeyProvider(event.target.value as ApiKeyProvider)}
                >
                  <option value="openai">openai</option>
                  <option value="anthropic">anthropic</option>
                  <option value="gemini">gemini</option>
                </select>
                <input
                  type="text"
                  value={newApiKeyLabel}
                  placeholder="Label (e.g. Personal OpenAI)"
                  onChange={(event) => setNewApiKeyLabel(event.target.value)}
                />
                <input
                  type="password"
                  value={newApiKeyValue}
                  placeholder="Paste API key"
                  onChange={(event) => setNewApiKeyValue(event.target.value)}
                />
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => void handleSaveApiKey()}
                  disabled={savingApiKey}
                >
                  {savingApiKey ? "Saving..." : "Save personal key"}
                </button>
              </div>
            </>
          ) : null}

          <div className="settings-field">
            <p className="settings-field-label">Context sources</p>
            <div className="source-chip-row">
              {SOURCE_OPTIONS.map((sourceOption) => {
                const selected = sources.includes(sourceOption.id);
                const count = datasetStats?.sourceDocCounts?.[sourceOption.id];
                return (
                  <button
                    key={sourceOption.id}
                    type="button"
                    className={`source-chip ${selected ? "active" : ""}`}
                    onClick={() => toggleSource(sourceOption.id)}
                  >
                    <span>{sourceOption.label}</span>
                    {typeof count === "number" ? <small>{count.toLocaleString()}</small> : null}
                  </button>
                );
              })}
            </div>
          </div>

          <label>
            Top K
            <input
              type="number"
              min={2}
              max={10}
              value={topK}
              onChange={(event) => setTopK(Number(event.target.value) || 6)}
            />
          </label>

          <label>
            Temperature
            <input
              type="number"
              min={0}
              max={1.2}
              step={0.1}
              value={temperature}
              onChange={(event) => setTemperature(Number(event.target.value) || 0.2)}
            />
          </label>

          <label>
            Max output tokens
            <input
              type="number"
              min={128}
              max={4096}
              value={maxOutputTokens}
              onChange={(event) => setMaxOutputTokens(Number(event.target.value) || 1200)}
            />
          </label>

          {threadDetail ? (
            <ThreadFeedbackBox
              disabled={submittingThreadFeedback}
              thread={threadDetail.thread}
              onSubmit={(rating, comment) => submitThreadFeedback(rating, comment)}
            />
          ) : null}

          {datasetStats ? (
            <div className="dataset-note">
              <h3>Dataset</h3>
              <p>{datasetStats.articleCount.toLocaleString()} articles indexed</p>
              <p>{datasetStats.chunkCount.toLocaleString()} chunks loaded</p>
              {datasetStats.sourceDocCounts ? (
                <p className="muted">
                  support docs: {(datasetStats.sourceDocCounts.support ?? 0).toLocaleString()} · dev docs:{" "}
                  {(datasetStats.sourceDocCounts.dev ?? 0).toLocaleString()}
                </p>
              ) : null}
              {datasetStats.sourceChunkCounts ? (
                <p className="muted">
                  support chunks: {(datasetStats.sourceChunkCounts.support ?? 0).toLocaleString()} · dev chunks:{" "}
                  {(datasetStats.sourceChunkCounts.dev ?? 0).toLocaleString()}
                </p>
              ) : null}
              <p className="muted">{datasetStats.chunksPath}</p>
            </div>
          ) : null}

          <div className="dataset-note">
            <h3>Wallet</h3>
            <p>Remaining: {formatUsdFromCents(me?.wallet.balanceCents ?? 0)}</p>
            <p>Total granted: {formatUsdFromCents(me?.wallet.lifetimeGrantedCents ?? 0)}</p>
            <p>Total spent: {formatUsdFromCents(me?.wallet.lifetimeSpentCents ?? 0)}</p>
          </div>
        </aside>
      </main>
    </div>
  );
}

function MessageFeedbackBox({
  message,
  onSubmit,
  disabled,
}: {
  message: ThreadMessage;
  onSubmit: (rating: number, comment: string) => void;
  disabled: boolean;
}) {
  const [rating, setRating] = useState<number>(message.feedback.mine?.rating ?? 5);
  const [comment, setComment] = useState<string>(message.feedback.mine?.comment ?? "");

  return (
    <div className="feedback-box">
      <p className="feedback-title">Rate this response</p>
      <div className="feedback-controls">
        <select value={rating} onChange={(event) => setRating(Number(event.target.value))} disabled={disabled}>
          <option value={5}>5 - Excellent</option>
          <option value={4}>4 - Good</option>
          <option value={3}>3 - Okay</option>
          <option value={2}>2 - Weak</option>
          <option value={1}>1 - Incorrect</option>
        </select>
        <button
          type="button"
          className="ghost-button"
          disabled={disabled}
          onClick={() => onSubmit(rating, comment)}
        >
          {disabled ? "Saving..." : "Save"}
        </button>
      </div>
      <textarea
        className="feedback-comment"
        rows={2}
        value={comment}
        onChange={(event) => setComment(event.target.value)}
        placeholder="Optional comment"
        disabled={disabled}
      />
    </div>
  );
}

function ThreadFeedbackBox({
  thread,
  onSubmit,
  disabled,
}: {
  thread: ThreadDetailResponse["thread"];
  onSubmit: (rating: number, comment: string) => void;
  disabled: boolean;
}) {
  const [rating, setRating] = useState<number>(thread.feedback.mine?.rating ?? 5);
  const [comment, setComment] = useState<string>(thread.feedback.mine?.comment ?? "");

  return (
    <div className="dataset-note">
      <h3>Thread Feedback</h3>
      <p>
        Average: {thread.feedback.averageRating ? thread.feedback.averageRating.toFixed(2) : "-"} ({thread.feedback.count})
      </p>
      <div className="feedback-controls">
        <select value={rating} onChange={(event) => setRating(Number(event.target.value))} disabled={disabled}>
          <option value={5}>5 - Excellent</option>
          <option value={4}>4 - Good</option>
          <option value={3}>3 - Okay</option>
          <option value={2}>2 - Weak</option>
          <option value={1}>1 - Poor</option>
        </select>
        <button
          type="button"
          className="ghost-button"
          disabled={disabled}
          onClick={() => onSubmit(rating, comment)}
        >
          {disabled ? "Saving..." : "Save"}
        </button>
      </div>
      <textarea
        className="feedback-comment"
        rows={2}
        value={comment}
        onChange={(event) => setComment(event.target.value)}
        placeholder="Optional thread-level feedback"
        disabled={disabled}
      />
    </div>
  );
}

function formatUsdFromCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatThreadTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }

  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function buildVisibleModelCatalog(catalog: ModelSpec[], showAllModels: boolean, selectedModelId: string): ModelSpec[] {
  if (showAllModels) {
    return catalog;
  }

  const miniMenuLimitPerProvider = 3;
  const modelsByProvider = new Map<ModelSpec["provider"], ModelSpec[]>();
  for (const model of catalog) {
    const providerModels = modelsByProvider.get(model.provider);
    if (providerModels) {
      providerModels.push(model);
    } else {
      modelsByProvider.set(model.provider, [model]);
    }
  }

  const filtered: ModelSpec[] = [];
  for (const providerModels of modelsByProvider.values()) {
    const rankedModels = [...providerModels].sort((left, right) => compareModelPopularity(right, left));
    filtered.push(...rankedModels.slice(0, miniMenuLimitPerProvider));
  }

  if (!filtered.some((model) => model.id === selectedModelId)) {
    const selectedModel = catalog.find((model) => model.id === selectedModelId);
    if (selectedModel) {
      return [selectedModel, ...filtered];
    }
  }

  return filtered;
}

function compareModelPopularity(left: ModelSpec, right: ModelSpec): number {
  const scoreDiff = scoreModelPopularity(left.apiModel) - scoreModelPopularity(right.apiModel);
  if (scoreDiff !== 0) {
    return scoreDiff;
  }

  return left.apiModel.localeCompare(right.apiModel, undefined, { numeric: true, sensitivity: "base" });
}

function scoreModelPopularity(apiModel: string): number {
  const normalized = apiModel.toLowerCase();
  let score = 0;

  if (!/-\d{4}-\d{2}-\d{2}$/.test(normalized) && !/-\d{8}$/.test(normalized)) {
    score += 18;
  }

  if (!/(preview|beta|experimental|exp|snapshot)/.test(normalized)) {
    score += 10;
  }

  if (/(mini|sonnet|flash)/.test(normalized)) {
    score += 12;
  }

  if (/(pro|opus)/.test(normalized)) {
    score += 6;
  }

  if (/haiku/.test(normalized)) {
    score += 4;
  }

  if (/nano/.test(normalized)) {
    score -= 8;
  }

  return score;
}
