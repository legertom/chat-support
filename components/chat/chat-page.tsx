"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useUserProfile } from "@/components/hooks/use-user-profile";
import { useThreads } from "@/components/hooks/use-threads";
import { useModelCatalog } from "@/components/hooks/use-model-catalog";
import { ThreadList } from "@/components/chat/thread-list";
import { ThreadDetail } from "@/components/chat/thread-detail";
import { ChatComposer } from "@/components/chat/chat-composer";
import { SettingsPanel } from "@/components/chat/settings-panel";
import {
  postMessage,
  submitMessageFeedback,
  submitThreadFeedback,
  fetchStats,
  type ApiKeyProvider,
  type StatsResponse,
} from "@/components/api-client";

type RetrievalSource = "support" | "dev";

export function RagLab() {
  const { me, apiKeys, refreshMe, loadApiKeys, createKey, deleteKey } = useUserProfile();
  const {
    threads,
    threadDetail,
    selectedThreadId,
    selectThread,
    createThread,
    loadThreads,
    loadThreadDetail,
    threadsScope,
    setThreadsScope,
    hasMore,
    loadingThreads,
    loadingThreadDetail,
  } = useThreads();
  const { modelId, setModelId, availableModels } = useModelCatalog();

  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [submittingFeedbackMessageId, setSubmittingFeedbackMessageId] = useState<string | null>(null);
  const [submittingThreadFeedback, setSubmittingThreadFeedback] = useState(false);
  const [keyMode, setKeyMode] = useState<"house" | "personal">("house");
  const [selectedUserApiKeyId, setSelectedUserApiKeyId] = useState<string>("");
  const [savingApiKey, setSavingApiKey] = useState(false);
  const [deletingApiKeyId, setDeletingApiKeyId] = useState<string | null>(null);
  const [datasetStats, setDatasetStats] = useState<StatsResponse["dataset"] | null>(null);
  const [showAllModels, setShowAllModels] = useState(false);
  const [sources, setSources] = useState<RetrievalSource[]>(["support", "dev"]);
  const [topK, setTopK] = useState(6);
  const [temperature, setTemperature] = useState(0.2);
  const [maxOutputTokens, setMaxOutputTokens] = useState(1200);

  useEffect(() => {
    void loadApiKeys();
    void loadDatasetStats();
  }, []);

  async function loadDatasetStats() {
    try {
      const stats = await fetchStats();
      setDatasetStats(stats.dataset);
    } catch (error) {
      console.error("Failed to load dataset stats:", error);
    }
  }

  async function handleCreateThread() {
    try {
      const threadId = await createThread();
      selectThread(threadId);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create thread.");
    }
  }

  async function handleSend(content: string) {
    if (sources.length === 0) {
      setError("Select at least one source for retrieval context.");
      return;
    }
    if (keyMode === "personal" && !selectedUserApiKeyId) {
      setError("Select a compatible personal API key for this model.");
      return;
    }

    setSending(true);
    setError(null);

    try {
      const threadId = selectedThreadId ?? (await createThread());
      if (!selectedThreadId) {
        selectThread(threadId);
      }

      const response = await postMessage({
        threadId,
        content,
        sources,
        modelId,
        topK,
        temperature,
        maxOutputTokens,
        userApiKeyId: keyMode === "personal" ? selectedUserApiKeyId : null,
      });

      if (response.status === 402 || response.code === "insufficient_balance") {
        const remaining =
          typeof response.remainingBalanceCents === "number" ? response.remainingBalanceCents : null;
        setError(
          remaining !== null
            ? `Insufficient balance. Remaining credit: ${formatUsdFromCents(remaining)}.`
            : response.error || "Insufficient balance."
        );
      }

      await Promise.all([loadThreadDetail(), loadThreads(), refreshMe()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message.");
    } finally {
      setSending(false);
    }
  }

  async function handleSubmitMessageFeedback(messageId: string, rating: number, comment?: string) {
    if (!selectedThreadId) return;
    try {
      setSubmittingFeedbackMessageId(messageId);
      await submitMessageFeedback(messageId, rating, comment);
      await loadThreadDetail();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save feedback.");
    } finally {
      setSubmittingFeedbackMessageId(null);
    }
  }

  async function handleSubmitThreadFeedback(rating: number, comment?: string) {
    if (!selectedThreadId) return;
    try {
      setSubmittingThreadFeedback(true);
      await submitThreadFeedback(selectedThreadId, rating, comment);
      await loadThreadDetail();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save thread feedback.");
    } finally {
      setSubmittingThreadFeedback(false);
    }
  }

  async function handleSaveApiKey(provider: ApiKeyProvider, label: string, apiKey: string) {
    try {
      setSavingApiKey(true);
      setError(null);
      const newKey = await createKey(provider, label, apiKey);
      setKeyMode("personal");
      setSelectedUserApiKeyId(newKey.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save API key.");
    } finally {
      setSavingApiKey(false);
    }
  }

  async function handleDeleteApiKey(id: string) {
    try {
      setDeletingApiKeyId(id);
      setError(null);
      await deleteKey(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to delete API key.");
    } finally {
      setDeletingApiKeyId(null);
    }
  }

  function toggleSource(source: RetrievalSource) {
    setSources((current) => {
      const next = current.includes(source) ? current.filter((item) => item !== source) : [...current, source];
      return ["support", "dev"].filter((item) => next.includes(item as RetrievalSource)) as RetrievalSource[];
    });
  }

  const accountLabel = me?.user.name?.trim()?.split(/\s+/)[0] || me?.user.email?.split("@")[0]?.slice(0, 18) || "Account";
  const accountInitial = accountLabel.charAt(0).toUpperCase();
  const selectedModel = availableModels.find((model) => model.id === modelId) ?? availableModels[0];

  const sourceLabel = sources.length === 0 ? "None" : sources.length === 2 ? "Support + Dev" : sources[0];

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
        <ThreadList
          threads={threads}
          selectedId={selectedThreadId}
          onSelect={(id) => {
            selectThread(id);
            setError(null);
          }}
          onCreateThread={handleCreateThread}
          scope={threadsScope}
          onScopeChange={setThreadsScope}
          hasMore={hasMore}
          loading={loadingThreads}
          sending={sending}
          userRole={me?.user.role}
        />

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

          <ThreadDetail
            threadDetail={threadDetail}
            loading={loadingThreadDetail}
            userId={me?.user.id}
            onSubmitMessageFeedback={handleSubmitMessageFeedback}
            submittingFeedbackMessageId={submittingFeedbackMessageId}
          />

          <ChatComposer onSend={handleSend} isSending={sending} activeThreadId={selectedThreadId} error={error} />
        </section>

        <SettingsPanel
          modelId={modelId}
          availableModels={availableModels}
          onModelChange={setModelId}
          showAllModels={showAllModels}
          onShowAllModelsChange={setShowAllModels}
          keyMode={keyMode}
          onKeyModeChange={setKeyMode}
          apiKeys={apiKeys}
          selectedUserApiKeyId={selectedUserApiKeyId}
          onApiKeyChange={setSelectedUserApiKeyId}
          onSaveApiKey={handleSaveApiKey}
          onDeleteApiKey={handleDeleteApiKey}
          savingApiKey={savingApiKey}
          deletingApiKeyId={deletingApiKeyId}
          sources={sources}
          onToggleSource={toggleSource}
          topK={topK}
          onTopKChange={setTopK}
          temperature={temperature}
          onTemperatureChange={setTemperature}
          maxOutputTokens={maxOutputTokens}
          onMaxOutputTokensChange={setMaxOutputTokens}
          threadDetail={threadDetail}
          submittingThreadFeedback={submittingThreadFeedback}
          onSubmitThreadFeedback={handleSubmitThreadFeedback}
          datasetStats={datasetStats}
          me={me}
        />
      </main>
    </div>
  );
}

function formatUsdFromCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
