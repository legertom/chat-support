import { useState } from "react";
import styles from "./chat-composer.module.css";

interface ChatComposerProps {
  onSend: (content: string) => void;
  isSending: boolean;
  activeThreadId: string | null;
  error: string | null;
}

export function ChatComposer({ onSend, isSending, activeThreadId, error }: ChatComposerProps) {
  const [prompt, setPrompt] = useState("");

  function handleSend() {
    const content = prompt.trim();
    if (!content || isSending) {
      return;
    }

    onSend(content);
    setPrompt("");
  }

  return (
    <div className={styles.composer}>
      <textarea
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        placeholder="Ask about Clever support flows, policies, or setup steps..."
        disabled={isSending}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            handleSend();
          }
        }}
      />

      {error ? <p className="error">{error}</p> : null}

      <div className={styles.composerActions}>
        <p>{activeThreadId ? "Cmd/Ctrl + Enter to send" : "Cmd/Ctrl + Enter to send (creates a thread)"}</p>
        <button type="button" onClick={handleSend} disabled={isSending || !prompt.trim()}>
          {isSending ? "Sending..." : "Send"}
        </button>
      </div>
    </div>
  );
}
