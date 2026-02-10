"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { normalizeAssistantContentForDisplay } from "@/lib/assistant-format";

export function AssistantMessageText({
  content,
  hasStructuredCitations,
}: {
  content: string;
  hasStructuredCitations: boolean;
}) {
  const displayContent = normalizeAssistantContentForDisplay(content, hasStructuredCitations);

  return (
    <div className="message-text assistant-text">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={safeUrlTransform}
        components={{
          a({ href, children }) {
            const safeHref = typeof href === "string" && href.length > 0 ? href : "";
            if (safeHref.length === 0) {
              return <>{children}</>;
            }
            return (
              <a href={safeHref} target="_blank" rel="noreferrer">
                {children}
              </a>
            );
          },
        }}
      >
        {displayContent}
      </ReactMarkdown>
    </div>
  );
}

function safeUrlTransform(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.toString();
    }
  } catch {
    return "";
  }

  return "";
}
