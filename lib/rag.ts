import type { ChatMessageInput } from "./types";
import type { RetrievalResult } from "./retrieval";

const MAX_HISTORY_MESSAGES = 12;

export function trimConversation(messages: ChatMessageInput[]): ChatMessageInput[] {
  if (messages.length <= MAX_HISTORY_MESSAGES) {
    return messages;
  }
  return messages.slice(messages.length - MAX_HISTORY_MESSAGES);
}

export function buildRagSystemPrompt(retrieval: RetrievalResult[]): string {
  const contextSections = retrieval
    .map((item, idx) => {
      const headingPath = item.chunk.heading_path?.join(" > ") ?? item.chunk.title;
      return [
        `[${idx + 1}]`,
        `Title: ${item.chunk.title}`,
        `URL: ${item.chunk.url}`,
        `Section: ${item.chunk.section ?? "(not provided)"}`,
        `Heading path: ${headingPath}`,
        `Excerpt:\n${item.chunk.text}`,
      ].join("\n");
    })
    .join("\n\n");

  return [
    "You are a support assistant for Clever support articles.",
    "Answer only using the supplied context excerpts.",
    "If the context is incomplete, say what is missing and suggest the closest supported next step.",
    "Never invent product behavior or policy.",
    "Cite supporting excerpts inline using [1], [2], etc.",
    "End each answer with a short 'Sources' section listing the citation numbers and URLs.",
    "",
    "Support article context:",
    contextSections || "No context found.",
  ].join("\n");
}
