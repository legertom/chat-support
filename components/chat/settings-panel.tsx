import { useMemo, useState } from "react";
import { ThreadFeedbackBox } from "@/components/chat/thread-feedback";
import type { ModelSpec } from "@/lib/models";
import type { ApiKeyProvider, UserApiKeyItem, ThreadDetailResponse, StatsResponse, MeResponse } from "@/components/api-client";
import type { ResearchSettings } from "@/components/hooks/use-persistent-settings";

type RetrievalSource = "support" | "dev";

const SOURCE_OPTIONS: Array<{ id: RetrievalSource; label: string }> = [
  { id: "support", label: "Support Docs" },
  { id: "dev", label: "Dev Docs" },
];

interface SettingsPanelProps {
  modelId: string;
  availableModels: ModelSpec[];
  onModelChange: (modelId: string) => void;
  showAllModels: boolean;
  onShowAllModelsChange: (show: boolean) => void;
  keyMode: "house" | "personal";
  onKeyModeChange: (mode: "house" | "personal") => void;
  apiKeys: UserApiKeyItem[];
  selectedUserApiKeyId: string;
  onApiKeyChange: (keyId: string) => void;
  onSaveApiKey: (provider: ApiKeyProvider, label: string, apiKey: string) => Promise<void>;
  onDeleteApiKey: (id: string) => Promise<void>;
  savingApiKey: boolean;
  deletingApiKeyId: string | null;
  sources: RetrievalSource[];
  onToggleSource: (source: RetrievalSource) => void;
  topK: number;
  onTopKChange: (value: number) => void;
  temperature: number;
  onTemperatureChange: (value: number) => void;
  maxOutputTokens: number;
  onMaxOutputTokensChange: (value: number) => void;
  threadDetail: ThreadDetailResponse | null;
  submittingThreadFeedback: boolean;
  onSubmitThreadFeedback: (rating: number, comment?: string) => void;
  datasetStats: StatsResponse["dataset"] | null;
  me: MeResponse | null;
  settings: ResearchSettings;
  onUpdateSetting: <K extends keyof ResearchSettings>(key: K, value: ResearchSettings[K]) => void;
}

export function SettingsPanel(props: SettingsPanelProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [newApiKeyProvider, setNewApiKeyProvider] = useState<ApiKeyProvider>("openai");
  const [newApiKeyLabel, setNewApiKeyLabel] = useState("");
  const [newApiKeyValue, setNewApiKeyValue] = useState("");

  const modelProvider = useMemo(() => {
    const separator = props.modelId.indexOf(":");
    return separator > 0 ? props.modelId.slice(0, separator) : "";
  }, [props.modelId]);

  const compatiblePersonalKeys = useMemo(
    () => props.apiKeys.filter((key) => key.provider === modelProvider),
    [modelProvider, props.apiKeys]
  );

  async function handleSaveApiKey() {
    const label = newApiKeyLabel.trim();
    const apiKey = newApiKeyValue.trim();
    if (!label || !apiKey) {
      return;
    }

    await props.onSaveApiKey(newApiKeyProvider, label, apiKey);
    setNewApiKeyLabel("");
    setNewApiKeyValue("");
  }

  return (
    <aside className="settings-column panel">
      <h2>Session</h2>

      <div className="settings-field">
        <p className="settings-field-label">Model</p>
        <label className="model-filter-toggle">
          <input
            type="checkbox"
            checked={props.showAllModels}
            onChange={(event) => props.onShowAllModelsChange(event.target.checked)}
          />
          <span>Show all available models</span>
        </label>
        <select value={props.modelId} onChange={(event) => props.onModelChange(event.target.value)}>
          {props.availableModels.map((model) => (
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
            checked={props.keyMode === "personal"}
            onChange={(event) => {
              const usePersonal = event.target.checked;
              props.onKeyModeChange(usePersonal ? "personal" : "house");
              if (usePersonal && !props.selectedUserApiKeyId) {
                props.onApiKeyChange(compatiblePersonalKeys[0]?.id ?? "");
              }
            }}
          />
          <span>Use personal API key (no app billing)</span>
        </label>
      </div>

      {props.keyMode === "personal" ? (
        <>
          <div className="settings-field">
            <p className="settings-field-label">Personal key for this model</p>
            <select value={props.selectedUserApiKeyId} onChange={(event) => props.onApiKeyChange(event.target.value)}>
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
            <p>Saved: {props.apiKeys.length}</p>
            {props.apiKeys.length === 0 ? (
              <p className="muted">No personal keys saved yet.</p>
            ) : (
              props.apiKeys.map((item) => (
                <p key={item.id}>
                  {item.label} ({item.provider}) {item.keyPreview}{" "}
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => void props.onDeleteApiKey(item.id)}
                    disabled={props.deletingApiKeyId === item.id}
                  >
                    {props.deletingApiKeyId === item.id ? "Deleting..." : "Delete"}
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
              disabled={props.savingApiKey}
            >
              {props.savingApiKey ? "Saving..." : "Save personal key"}
            </button>
          </div>
        </>
      ) : null}

      <div className="settings-field">
        <p className="settings-field-label">Context sources</p>
        <div className="source-chip-row">
          {SOURCE_OPTIONS.map((sourceOption) => {
            const selected = props.sources.includes(sourceOption.id);
            const count = props.datasetStats?.sourceDocCounts?.[sourceOption.id];
            return (
              <button
                key={sourceOption.id}
                type="button"
                className={`source-chip ${selected ? "active" : ""}`}
                onClick={() => props.onToggleSource(sourceOption.id)}
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
          value={props.topK}
          onChange={(event) => props.onTopKChange(Number(event.target.value) || 6)}
        />
      </label>

      <label>
        Temperature
        <input
          type="number"
          min={0}
          max={1.2}
          step={0.1}
          value={props.temperature}
          onChange={(event) => props.onTemperatureChange(Number(event.target.value) || 0.2)}
        />
      </label>

      <label>
        Max output tokens
        <input
          type="number"
          min={128}
          max={4096}
          value={props.maxOutputTokens}
          onChange={(event) => props.onMaxOutputTokensChange(Number(event.target.value) || 1200)}
        />
      </label>

      <div className="advanced-settings-trigger">
        <button
          className={`ghost-button researcher-toggle ${showAdvanced ? "active" : ""}`}
          onClick={() => setShowAdvanced(!showAdvanced)}
        >
          {showAdvanced ? "Hide Advanced Research Skills" : "Show Advanced Research Skills"}
        </button>
      </div>

      {showAdvanced && (
        <div className="advanced-researcher-pane">
          <div className="settings-field">
            <p className="settings-field-label">RAG Chunk Size ({props.settings.ragChunkSize})</p>
            <input
              type="range" min="100" max="1500" step="50"
              value={props.settings.ragChunkSize}
              onChange={(e) => props.onUpdateSetting("ragChunkSize", parseInt(e.target.value))}
            />
          </div>

          <div className="settings-field">
            <p className="settings-field-label">Daily Volume ({props.settings.dailyVolume})</p>
            <input
              type="range" min="1" max="5000" step="1"
              value={props.settings.dailyVolume}
              onChange={(e) => props.onUpdateSetting("dailyVolume", parseInt(e.target.value))}
            />
          </div>

          <div className="settings-field">
            <p className="settings-field-label">Markup / Margin ({props.settings.markupPercent}%)</p>
            <input
              type="range" min="0" max="500" step="5"
              value={props.settings.markupPercent}
              onChange={(e) => props.onUpdateSetting("markupPercent", parseInt(e.target.value))}
            />
          </div>

          <div className="settings-field">
            <label className="check-label">
              <input
                type="checkbox"
                checked={props.settings.promptCachingEnabled}
                onChange={(e) => props.onUpdateSetting("promptCachingEnabled", e.target.checked)}
              />
              <span>Prompt Caching</span>
            </label>
          </div>
        </div>
      )}

      {props.threadDetail ? (
        <ThreadFeedbackBox
          disabled={props.submittingThreadFeedback}
          thread={props.threadDetail.thread}
          onSubmit={props.onSubmitThreadFeedback}
        />
      ) : null}

      {props.datasetStats ? (
        <div className="dataset-note">
          <h3>Dataset</h3>
          <p>{props.datasetStats.articleCount.toLocaleString()} articles indexed</p>
          <p>{props.datasetStats.chunkCount.toLocaleString()} chunks loaded</p>
          {props.datasetStats.sourceDocCounts ? (
            <p className="muted">
              support docs: {(props.datasetStats.sourceDocCounts.support ?? 0).toLocaleString()} · dev docs:{" "}
              {(props.datasetStats.sourceDocCounts.dev ?? 0).toLocaleString()}
            </p>
          ) : null}
          {props.datasetStats.sourceChunkCounts ? (
            <p className="muted">
              support chunks: {(props.datasetStats.sourceChunkCounts.support ?? 0).toLocaleString()} · dev chunks:{" "}
              {(props.datasetStats.sourceChunkCounts.dev ?? 0).toLocaleString()}
            </p>
          ) : null}
          <p className="muted">{props.datasetStats.chunksPath}</p>
        </div>
      ) : null}

      <div className="dataset-note">
        <h3>Wallet</h3>
        <p>Remaining: {formatUsdFromCents(props.me?.wallet.balanceCents ?? 0)}</p>
        <p>Total granted: {formatUsdFromCents(props.me?.wallet.lifetimeGrantedCents ?? 0)}</p>
        <p>Total spent: {formatUsdFromCents(props.me?.wallet.lifetimeSpentCents ?? 0)}</p>
      </div>
    </aside>
  );
}

function formatUsdFromCents(cents: number): string {
  const usd = cents / 100;
  if (usd === 0) return "$0.00";
  if (usd >= 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(6)}`;
}
