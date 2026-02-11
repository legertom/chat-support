import { prisma } from "@/lib/db/prisma";
import { ApiError } from "@/lib/http";
import { assertThreadAccess } from "@/lib/threads";
import type { ThreadDetailResponse } from "@/components/api-client";

export async function getThreadWithStats(threadId: string, userId: string): Promise<ThreadDetailResponse> {
  const thread = await prisma.thread.findUnique({
    where: {
      id: threadId,
    },
    include: {
      participants: {
        select: {
          userId: true,
        },
      },
      createdBy: {
        select: {
          id: true,
          email: true,
          name: true,
        },
      },
      feedback: {
        select: {
          id: true,
          userId: true,
          rating: true,
          comment: true,
          createdAt: true,
          updatedAt: true,
        },
      },
      messages: {
        orderBy: {
          createdAt: "asc",
        },
        include: {
          citations: {
            orderBy: {
              score: "desc",
            },
          },
          feedback: {
            select: {
              userId: true,
              rating: true,
              comment: true,
              createdAt: true,
              updatedAt: true,
            },
          },
          user: {
            select: {
              id: true,
              email: true,
              name: true,
            },
          },
        },
      },
    },
  });

  if (!thread) {
    throw new ApiError(404, "Thread not found", "thread_not_found");
  }

  assertThreadAccess({
    thread: {
      visibility: thread.visibility,
      createdByUserId: thread.createdByUserId,
      participants: thread.participants,
    },
    userId,
  });

  const feedbackCount = thread.feedback.length;
  const avgThreadRating =
    feedbackCount > 0
      ? Number((thread.feedback.reduce((acc, feedback) => acc + feedback.rating, 0) / feedbackCount).toFixed(2))
      : null;

  return {
    thread: {
      id: thread.id,
      title: thread.title,
      visibility: thread.visibility,
      createdAt: thread.createdAt.toISOString(),
      updatedAt: thread.updatedAt.toISOString(),
      createdBy: thread.createdBy,
      feedback: {
        averageRating: avgThreadRating,
        count: feedbackCount,
        mine: thread.feedback.find((feedback) => feedback.userId === userId) ?? null,
      },
    },
    messages: thread.messages.map((message) => {
      const messageFeedbackCount = message.feedback.length;
      const messageAvgRating =
        messageFeedbackCount > 0
          ? Number(
              (
                message.feedback.reduce((acc, feedback) => acc + feedback.rating, 0) / messageFeedbackCount
              ).toFixed(2)
            )
          : null;

      return {
        id: message.id,
        role: message.role,
        content: message.content,
        modelId: message.modelId,
        provider: message.provider,
        usage: message.usage as { inputTokens?: number; outputTokens?: number; totalTokens?: number } | null,
        costCents: message.costCents,
        createdAt: message.createdAt.toISOString(),
        user: message.user,
        citations: message.citations,
        feedback: {
          averageRating: messageAvgRating,
          count: messageFeedbackCount,
          mine: message.feedback.find((feedback) => feedback.userId === userId) ?? null,
        },
      };
    }),
  };
}
