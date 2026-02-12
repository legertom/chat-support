import { useEffect, useRef } from "react";
import { AssistantMessageText } from "@/components/assistant-message-text";
import { MessageFeedbackBox } from "@/components/chat/message-feedback";
import type { ThreadDetailResponse } from "@/components/api-client";
import styles from "./thread-detail.module.css";

interface ThreadDetailProps {
  threadDetail: ThreadDetailResponse | null;
  loading: boolean;
  userId: string | undefined;
  onSubmitMessageFeedback: (messageId: string, rating: number, comment?: string) => Promise<void>;
  submittingFeedbackMessageId: string | null;
  streamingContent?: string | null;
  isWaitingForResponse?: boolean;
}

export function ThreadDetail({
  threadDetail,
  loading,
  onSubmitMessageFeedback,
  submittingFeedbackMessageId,
  streamingContent,
  isWaitingForResponse,
}: ThreadDetailProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [streamingContent, threadDetail?.messages.length]);

  if (loading) {
    return (
      <div className={styles.messages}>
        <div className={styles.emptyState}>
          <p>Loading thread messages...</p>
        </div>
      </div>
    );
  }

  if (!threadDetail) {
    return (
      <div className={styles.messages}>
        <div className={styles.emptyState}>
          <h2>No thread selected</h2>
          <p>Create or select a thread to start chatting.</p>
        </div>
      </div>
    );
  }

  if (threadDetail.messages.length === 0) {
    return (
      <div className={styles.messages}>
        <div className={styles.emptyState}>
          <h2>Ask about Clever support docs</h2>
          <p>Threads are visible org-wide by default unless created as private.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.messages}>
      {threadDetail.messages.map((message) => (
        <article key={message.id} className={`${styles.messageCard} ${message.role}`}>
          <header>
            <span className={styles.roleLabel}>
              {message.role === "assistant" ? "Assistant" : message.role === "user" ? "You" : "System"}
            </span>
            <span className={styles.timestamp}>{new Date(message.createdAt).toLocaleString()}</span>
          </header>

          {message.role === "assistant" ? (
            <AssistantMessageText content={message.content} hasStructuredCitations={message.citations.length > 0} />
          ) : (
            <p className={`${styles.messageText} ${styles.userText}`}>{message.content}</p>
          )}

          <footer className={styles.messageMeta}>
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
            <details className={styles.citations}>
              <summary>Sources ({message.citations.length})</summary>
              {message.citations.map((citation) => (
                <div key={citation.id} className={styles.citationRow}>
                  <p className={styles.citationsTitle}>
                    <a href={citation.url} target="_blank" rel="noreferrer">
                      {citation.title}
                    </a>
                  </p>
                  <p className={styles.snippet}>{citation.snippet}</p>
                </div>
              ))}
            </details>
          ) : null}

          {message.role === "assistant" ? (
            <MessageFeedbackBox
              message={message}
              disabled={submittingFeedbackMessageId === message.id}
              onSubmit={(rating, comment) => onSubmitMessageFeedback(message.id, rating, comment)}
            />
          ) : null}
        </article>
      ))}

      {(isWaitingForResponse || streamingContent) ? (
        <article className={`${styles.messageCard} assistant`}>
          <header>
            <span className={styles.roleLabel}>Assistant</span>
          </header>
          {streamingContent ? (
            <AssistantMessageText content={streamingContent} hasStructuredCitations={false} />
          ) : (
            <div className={styles.thinkingIndicator}>
              <span className={styles.thinkingDot} />
              <span className={styles.thinkingDot} />
              <span className={styles.thinkingDot} />
            </div>
          )}
        </article>
      ) : null}
      <div ref={messagesEndRef} />
    </div>
  );
}

function formatUsdFromCents(cents: number): string {
  const usd = cents / 100;
  if (usd === 0) return "$0.00";
  if (usd >= 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(6)}`;
}
