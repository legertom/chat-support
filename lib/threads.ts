import { ApiError } from "@/lib/http";

export const DEFAULT_THREAD_TITLE = "New thread";

export function deriveThreadTitleFromContent(content: string): string {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return DEFAULT_THREAD_TITLE;
  }

  if (normalized.length <= 72) {
    return normalized;
  }

  return `${normalized.slice(0, 69).trimEnd()}...`;
}

export function assertThreadAccess(input: {
  thread: {
    visibility: "org" | "private";
    createdByUserId: string;
    participants: Array<{ userId: string }>;
  };
  userId: string;
}) {
  if (input.thread.visibility === "org") {
    return;
  }

  if (input.thread.createdByUserId === input.userId) {
    return;
  }

  if (input.thread.participants.some((participant) => participant.userId === input.userId)) {
    return;
  }

  throw new ApiError(403, "Forbidden", "forbidden");
}
