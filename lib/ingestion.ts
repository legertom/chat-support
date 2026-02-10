import { prisma } from "@/lib/prisma";

export async function queueMessageIngestionCandidate(input: {
  messageId: string;
  threadId: string;
  createdByUserId: string;
  summary: string;
}) {
  const existing = await prisma.ingestionCandidate.findFirst({
    where: {
      messageId: input.messageId,
      status: "pending",
    },
    select: {
      id: true,
    },
  });

  if (existing) {
    return existing;
  }

  return prisma.ingestionCandidate.create({
    data: {
      sourceType: "message",
      messageId: input.messageId,
      threadId: input.threadId,
      createdByUserId: input.createdByUserId,
      summary: input.summary,
    },
    select: {
      id: true,
    },
  });
}

export async function queueThreadIngestionCandidate(input: {
  threadId: string;
  createdByUserId: string;
  summary: string;
}) {
  const existing = await prisma.ingestionCandidate.findFirst({
    where: {
      threadId: input.threadId,
      sourceType: "thread",
      status: "pending",
    },
    select: {
      id: true,
    },
  });

  if (existing) {
    return existing;
  }

  return prisma.ingestionCandidate.create({
    data: {
      sourceType: "thread",
      threadId: input.threadId,
      createdByUserId: input.createdByUserId,
      summary: input.summary,
    },
    select: {
      id: true,
    },
  });
}

export function summarizeFeedbackCandidate(input: {
  context: "message" | "thread";
  rating: number;
  comment?: string | null;
  excerpt: string;
}): string {
  const comment = input.comment?.trim();
  const commentPart = comment ? `Feedback comment: ${comment}` : "Feedback comment: (none provided)";
  const excerpt = input.excerpt.trim().slice(0, 800);

  return [
    `Source: ${input.context}`,
    `Rating: ${input.rating}/5`,
    commentPart,
    "Content excerpt:",
    excerpt,
  ].join("\n");
}
