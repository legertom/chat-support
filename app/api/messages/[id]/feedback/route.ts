import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError, jsonError } from "@/lib/http";
import { parseJsonBody } from "@/lib/request";
import { requireDbUser } from "@/lib/server-auth";
import { assertThreadAccess } from "@/lib/threads";
import { messageFeedbackSchema } from "@/lib/validators";
import { recomputeRetrievalSignalsForChunks } from "@/lib/retrieval-weighting";
import { queueMessageIngestionCandidate, summarizeFeedbackCandidate } from "@/lib/ingestion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireDbUser();
    const { id: messageId } = await context.params;
    const body = await parseJsonBody(request, messageFeedbackSchema);

    const message = await prisma.message.findUnique({
      where: {
        id: messageId,
      },
      include: {
        thread: {
          include: {
            participants: {
              select: {
                userId: true,
              },
            },
          },
        },
        citations: {
          select: {
            chunkId: true,
          },
        },
      },
    });

    if (!message) {
      throw new ApiError(404, "Message not found", "message_not_found");
    }

    assertThreadAccess({
      thread: {
        visibility: message.thread.visibility,
        createdByUserId: message.thread.createdByUserId,
        participants: message.thread.participants,
      },
      userId: user.id,
    });

    const feedback = await prisma.messageFeedback.upsert({
      where: {
        messageId_userId: {
          messageId,
          userId: user.id,
        },
      },
      create: {
        messageId,
        userId: user.id,
        rating: body.rating,
        comment: body.comment?.trim() || null,
      },
      update: {
        rating: body.rating,
        comment: body.comment?.trim() || null,
      },
    });

    const chunkIds = message.citations.map((citation) => citation.chunkId);
    if (chunkIds.length > 0) {
      await recomputeRetrievalSignalsForChunks(chunkIds);
    }

    if (body.rating >= 4) {
      const summary = summarizeFeedbackCandidate({
        context: "message",
        rating: body.rating,
        comment: body.comment ?? null,
        excerpt: message.content,
      });

      await queueMessageIngestionCandidate({
        messageId: message.id,
        threadId: message.threadId,
        createdByUserId: user.id,
        summary,
      });
    }

    return NextResponse.json({ feedback });
  } catch (error) {
    return jsonError(error);
  }
}
