"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type ApiKeyProvider = "openai" | "anthropic" | "gemini";

interface MeResponse {
  user: {
    id: string;
    email: string;
    name: string | null;
    role: "admin" | "member";
    status: "active" | "disabled";
    createdAt: string;
    lastActiveAt: string | null;
  };
  wallet: {
    balanceCents: number;
    lifetimeGrantedCents: number;
    lifetimeSpentCents: number;
  };
  usage: {
    billedTurnCount: number;
    lifetimeInputTokens: number;
    lifetimeOutputTokens: number;
    lifetimeTotalTokens: number;
  };
}

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

interface EditableKey {
  id: string;
  provider: ApiKeyProvider;
  label: string;
  apiKey: string;
}

export function ProfilePage() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [keys, setKeys] = useState<UserApiKeyItem[]>([]);
  const [nameInput, setNameInput] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [savingKey, setSavingKey] = useState(false);
  const [updatingKeyId, setUpdatingKeyId] = useState<string | null>(null);
  const [deletingKeyId, setDeletingKeyId] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<EditableKey | null>(null);
  const [newProvider, setNewProvider] = useState<ApiKeyProvider>("openai");
  const [newLabel, setNewLabel] = useState("");
  const [newApiKey, setNewApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const createdDateLabel = useMemo(() => {
    if (!me?.user.createdAt) {
      return "-";
    }
    return formatDate(me.user.createdAt);
  }, [me?.user.createdAt]);

  useEffect(() => {
    void (async () => {
      try {
        setError(null);
        await refreshAll();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to load profile.");
      }
    })();
  }, []);

  async function refreshAll() {
    await Promise.all([loadMe(), loadKeys()]);
  }

  async function loadMe() {
    const response = await fetch("/api/me", { method: "GET" });
    if (!response.ok) {
      if (response.status === 401) {
        window.location.href = "/signin";
        return;
      }
      const payload = (await response.json()) as { error?: string };
      throw new Error(payload.error || `Failed to load profile (${response.status})`);
    }

    const payload = (await response.json()) as MeResponse;
    setMe(payload);
    setNameInput(payload.user.name ?? "");
  }

  async function loadKeys() {
    const response = await fetch("/api/me/keys", { method: "GET" });
    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      throw new Error(payload.error || `Failed to load API keys (${response.status})`);
    }

    const payload = (await response.json()) as UserApiKeysResponse;
    setKeys(payload.items);
  }

  async function handleSaveName() {
    const nextName = nameInput.trim();
    if (!nextName) {
      setError("Name cannot be empty.");
      return;
    }

    try {
      setSavingName(true);
      setError(null);
      setNotice(null);

      const response = await fetch("/api/me", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: nextName,
        }),
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || `Failed to update name (${response.status})`);
      }

      setNotice("Profile name updated.");
      await loadMe();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update profile name.");
    } finally {
      setSavingName(false);
    }
  }

  async function handleCreateKey() {
    const label = newLabel.trim();
    const apiKey = newApiKey.trim();

    if (!label || !apiKey) {
      setError("Provide both a label and API key.");
      return;
    }

    try {
      setSavingKey(true);
      setError(null);
      setNotice(null);

      const response = await fetch("/api/me/keys", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          provider: newProvider,
          label,
          apiKey,
        }),
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || `Failed to save key (${response.status})`);
      }

      setNewApiKey("");
      setNewLabel("");
      setNotice("API key saved.");
      await loadKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save API key.");
    } finally {
      setSavingKey(false);
    }
  }

  async function handleUpdateKey() {
    if (!editingKey) {
      return;
    }

    const label = editingKey.label.trim();
    if (!label) {
      setError("Label cannot be empty.");
      return;
    }

    const payload: {
      label?: string;
      provider?: ApiKeyProvider;
      apiKey?: string;
    } = {
      label,
      provider: editingKey.provider,
    };

    if (editingKey.apiKey.trim()) {
      payload.apiKey = editingKey.apiKey.trim();
    }

    try {
      setUpdatingKeyId(editingKey.id);
      setError(null);
      setNotice(null);

      const response = await fetch(`/api/me/keys/${editingKey.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const responsePayload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(responsePayload.error || `Failed to update key (${response.status})`);
      }

      setEditingKey(null);
      setNotice("API key updated.");
      await loadKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update API key.");
    } finally {
      setUpdatingKeyId(null);
    }
  }

  async function handleDeleteKey(id: string) {
    try {
      setDeletingKeyId(id);
      setError(null);
      setNotice(null);

      const response = await fetch(`/api/me/keys/${id}`, {
        method: "DELETE",
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || `Failed to delete key (${response.status})`);
      }

      setNotice("API key deleted.");
      if (editingKey?.id === id) {
        setEditingKey(null);
      }
      await loadKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to delete API key.");
    } finally {
      setDeletingKeyId(null);
    }
  }

  return (
    <div className="profile-shell">
      <header className="profile-header panel">
        <div>
          <p className="eyebrow">User Profile</p>
          <h1>Account Settings</h1>
          <p className="subtitle">Manage your identity, API keys, and lifetime usage metrics.</p>
        </div>

        <div className="profile-header-actions">
          <Link href="/" className="ghost-link">
            Back To Chat
          </Link>
          <a href="/api/auth/signout?callbackUrl=/signin" className="ghost-link">
            Sign out
          </a>
        </div>
      </header>

      <main className="profile-grid">
        <section className="panel profile-card">
          <h2>Profile</h2>
          <p className="muted">Email: {me?.user.email ?? "-"}</p>
          <p className="muted">Member since: {createdDateLabel}</p>
          <label className="profile-field">
            Display name
            <input
              type="text"
              value={nameInput}
              placeholder="Your name"
              onChange={(event) => setNameInput(event.target.value)}
              disabled={savingName}
            />
          </label>
          <button type="button" className="primary-button" onClick={() => void handleSaveName()} disabled={savingName}>
            {savingName ? "Saving..." : "Save name"}
          </button>
        </section>

        <section className="panel profile-card">
          <h2>Lifetime Stats</h2>
          <div className="profile-stats-grid">
            <div className="profile-stat-tile">
              <span>Input tokens</span>
              <strong>{(me?.usage.lifetimeInputTokens ?? 0).toLocaleString()}</strong>
            </div>
            <div className="profile-stat-tile">
              <span>Output tokens</span>
              <strong>{(me?.usage.lifetimeOutputTokens ?? 0).toLocaleString()}</strong>
            </div>
            <div className="profile-stat-tile">
              <span>Total tokens</span>
              <strong>{(me?.usage.lifetimeTotalTokens ?? 0).toLocaleString()}</strong>
            </div>
            <div className="profile-stat-tile">
              <span>Billed turns</span>
              <strong>{(me?.usage.billedTurnCount ?? 0).toLocaleString()}</strong>
            </div>
            <div className="profile-stat-tile">
              <span>Lifetime spent</span>
              <strong>{formatUsdFromCents(me?.wallet.lifetimeSpentCents ?? 0)}</strong>
            </div>
            <div className="profile-stat-tile">
              <span>Current balance</span>
              <strong>{formatUsdFromCents(me?.wallet.balanceCents ?? 0)}</strong>
            </div>
          </div>
        </section>

        <section className="panel profile-card profile-card-wide">
          <h2>API Keys</h2>
          <p className="muted">Create, edit, and delete personal provider keys used for bring-your-own-key sessions.</p>

          <div className="profile-key-create-row">
            <select value={newProvider} onChange={(event) => setNewProvider(event.target.value as ApiKeyProvider)}>
              <option value="openai">openai</option>
              <option value="anthropic">anthropic</option>
              <option value="gemini">gemini</option>
            </select>
            <input
              type="text"
              value={newLabel}
              placeholder="Label"
              onChange={(event) => setNewLabel(event.target.value)}
            />
            <input
              type="password"
              value={newApiKey}
              placeholder="Paste API key"
              onChange={(event) => setNewApiKey(event.target.value)}
            />
            <button type="button" className="ghost-button" onClick={() => void handleCreateKey()} disabled={savingKey}>
              {savingKey ? "Saving..." : "Add key"}
            </button>
          </div>

          {keys.length === 0 ? <p className="muted">No keys saved yet.</p> : null}

          <div className="profile-key-list">
            {keys.map((key) => {
              const isEditing = editingKey?.id === key.id;
              return (
                <article key={key.id} className="profile-key-item">
                  {isEditing ? (
                    <>
                      <select
                        value={editingKey.provider}
                        onChange={(event) =>
                          setEditingKey((current) =>
                            current
                              ? {
                                  ...current,
                                  provider: event.target.value as ApiKeyProvider,
                                }
                              : null
                          )
                        }
                      >
                        <option value="openai">openai</option>
                        <option value="anthropic">anthropic</option>
                        <option value="gemini">gemini</option>
                      </select>
                      <input
                        type="text"
                        value={editingKey.label}
                        onChange={(event) =>
                          setEditingKey((current) => (current ? { ...current, label: event.target.value } : null))
                        }
                      />
                      <input
                        type="password"
                        value={editingKey.apiKey}
                        placeholder="Leave blank to keep existing key"
                        onChange={(event) =>
                          setEditingKey((current) => (current ? { ...current, apiKey: event.target.value } : null))
                        }
                      />
                      <div className="row-actions">
                        <button
                          type="button"
                          className="ghost-button"
                          onClick={() => void handleUpdateKey()}
                          disabled={updatingKeyId === key.id}
                        >
                          {updatingKeyId === key.id ? "Saving..." : "Save"}
                        </button>
                        <button
                          type="button"
                          className="ghost-button"
                          onClick={() => setEditingKey(null)}
                          disabled={updatingKeyId === key.id}
                        >
                          Cancel
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <p>
                        <strong>{key.label}</strong> ({key.provider})
                      </p>
                      <p className="muted">{key.keyPreview}</p>
                      <p className="muted">Updated {formatDate(key.updatedAt)}</p>
                      <div className="row-actions">
                        <button
                          type="button"
                          className="ghost-button"
                          onClick={() =>
                            setEditingKey({
                              id: key.id,
                              provider: key.provider,
                              label: key.label,
                              apiKey: "",
                            })
                          }
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="ghost-button"
                          onClick={() => void handleDeleteKey(key.id)}
                          disabled={deletingKeyId === key.id}
                        >
                          {deletingKeyId === key.id ? "Deleting..." : "Delete"}
                        </button>
                      </div>
                    </>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      </main>

      {error ? <p className="error">{error}</p> : null}
      {notice ? <p className="profile-notice">{notice}</p> : null}
    </div>
  );
}

function formatUsdFromCents(cents: number): string {
  const usd = cents / 100;
  if (usd === 0) return "$0.00";
  if (usd >= 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(6)}`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return date.toLocaleString();
}
