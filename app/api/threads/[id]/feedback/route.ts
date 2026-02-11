import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { ApiError, jsonError } from "@/lib/http";
import { parseJsonBody } from "@/lib/request";
import { requireDbUser } from "@/lib/server-auth";
import { assertThreadAccess } from "@/lib/threads";
import { threadFeedbackSchema } from "@/lib/validators";
import { recomputeRetrievalSignalsForChunks } from "@/lib/retrieval-weighting";
import { queueThreadIngestionCandidate, summarizeFeedbackCandidate } from "@/lib/ingestion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireDbUser();
    const { id: threadId } = await context.params;
    const body = await parseJsonBody(request, threadFeedbackSchema);

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
        messages: {
          select: {
            content: true,
            citations: {
              select: {
                chunkId: true,
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
      userId: user.id,
    });

    const feedback = await prisma.threadFeedback.upsert({
      where: {
        threadId_userId: {
          threadId,
          userId: user.id,
        },
      },
      create: {
        threadId,
        userId: user.id,
        rating: body.rating,
        comment: body.comment?.trim() || null,
      },
      update: {
        rating: body.rating,
        comment: body.comment?.trim() || null,
      },
    });

    const chunkIds = thread.messages.flatMap((message) => message.citations.map((citation) => citation.chunkId));
    if (chunkIds.length > 0) {
      await recomputeRetrievalSignalsForChunks(chunkIds);
    }

    if (body.rating >= 4) {
      const excerpt = thread.messages
        .map((message) => message.content)
        .join("\n")
        .slice(0, 2000);

      const summary = summarizeFeedbackCandidate({
        context: "thread",
        rating: body.rating,
        comment: body.comment ?? null,
        excerpt,
      });

      await queueThreadIngestionCandidate({
        threadId,
        createdByUserId: user.id,
        summary,
      });
    }

    return NextResponse.json({ feedback });
  } catch (error) {
    return jsonError(error);
  }
}
