import type { ThreadListItem } from "@/components/api-client";
import styles from "./thread-list.module.css";

const MAX_PREVIEW_LENGTH = 150;

interface ThreadListProps {
  threads: ThreadListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreateThread: () => void;
  scope: "all" | "mine";
  onScopeChange: (scope: "all" | "mine") => void;
  onLoadMore?: () => void;
  hasMore: boolean;
  loading: boolean;
  sending: boolean;
  userRole?: "admin" | "member";
}

export function ThreadList({
  threads,
  selectedId,
  onSelect,
  onCreateThread,
  scope,
  onScopeChange,
  hasMore,
  loading,
  sending,
  userRole,
}: ThreadListProps) {
  return (
    <aside className={`${styles.threadsColumn} panel`}>
      <div className={styles.threadsToolbar}>
        <h2>Threads</h2>
        <button type="button" onClick={onCreateThread} className="ghost-button" disabled={sending}>
          New Thread
        </button>
      </div>

      <div className={styles.scopeToggle} role="tablist" aria-label="Thread scope">
        <button
          type="button"
          className={scope === "all" ? "active" : ""}
          onClick={() => onScopeChange("all")}
          disabled={loading}
        >
          All
        </button>
        <button
          type="button"
          className={scope === "mine" ? "active" : ""}
          onClick={() => onScopeChange("mine")}
          disabled={loading}
        >
          Mine
        </button>
      </div>

      <ul className={styles.threadList}>
        {loading ? (
          <li className={styles.threadRow}>
            <p className="muted">Loading threads...</p>
          </li>
        ) : threads.length === 0 ? (
          <li className={styles.threadRow}>
            <p className="muted">No threads yet. Start with "New Thread".</p>
          </li>
        ) : (
          threads.map((thread) => {
            const active = thread.id === selectedId;
            return (
              <li key={thread.id} className={`${styles.threadRow} ${active ? "active" : ""}`}>
                <button
                  type="button"
                  className={styles.threadItem}
                  onClick={() => onSelect(thread.id)}
                >
                  <span className={styles.threadTitle}>{thread.title}</span>
                  <span className={styles.threadPreview}>
                    {thread.lastMessage?.contentPreview?.slice(0, MAX_PREVIEW_LENGTH) || "No messages yet."}
                  </span>
                  <span className={styles.threadMeta}>
                    {thread.messageCount.toLocaleString()} msg · {formatThreadTimestamp(thread.updatedAt)}
                  </span>
                </button>
              </li>
            );
          })
        )}
      </ul>

      <div className={styles.navLinks}>
        <a href="/api/auth/signout?callbackUrl=/signin" className="ghost-button">
          Sign out
        </a>
        {userRole === "admin" ? (
          <a href="/admin" className="ghost-button">
            Admin
          </a>
        ) : null}
      </div>
    </aside>
  );
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
