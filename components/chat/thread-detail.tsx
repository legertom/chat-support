import { AssistantMessageText } from "@/components/assistant-message-text";
import { MessageFeedbackBox } from "@/components/chat/message-feedback";
import type { ThreadDetailResponse } from "@/components/api-client";

interface ThreadDetailProps {
  threadDetail: ThreadDetailResponse | null;
  loading: boolean;
  userId: string | undefined;
  onSubmitMessageFeedback: (messageId: string, rating: number, comment?: string) => Promise<void>;
  submittingFeedbackMessageId: string | null;
}

export function ThreadDetail({
  threadDetail,
  loading,
  onSubmitMessageFeedback,
  submittingFeedbackMessageId,
}: ThreadDetailProps) {
  if (loading) {
    return (
      <div className="messages">
        <div className="empty-state">
          <p>Loading thread messages...</p>
        </div>
      </div>
    );
  }

  if (!threadDetail) {
    return (
      <div className="messages">
        <div className="empty-state">
          <h2>No thread selected</h2>
          <p>Create or select a thread to start chatting.</p>
        </div>
      </div>
    );
  }

  if (threadDetail.messages.length === 0) {
    return (
      <div className="messages">
        <div className="empty-state">
          <h2>Ask about Clever support docs</h2>
          <p>Threads are visible org-wide by default unless created as private.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="messages">
      {threadDetail.messages.map((message) => (
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
              onSubmit={(rating, comment) => onSubmitMessageFeedback(message.id, rating, comment)}
            />
          ) : null}
        </article>
      ))}
    </div>
  );
}

function formatUsdFromCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
