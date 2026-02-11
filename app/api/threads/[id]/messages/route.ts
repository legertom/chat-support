import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { ApiError, jsonError } from "@/lib/http";
import { parseJsonBody } from "@/lib/request";
import { requireDbUser } from "@/lib/server-auth";
import { assertThreadAccess, deriveThreadTitleFromContent } from "@/lib/threads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const messageCreateSchema = z.object({
  role: z.enum(["user", "system"]).default("user"),
  content: z.string().trim().min(1).max(20_000),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireDbUser();
    const { id: threadId } = await context.params;

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

    const body = await parseJsonBody(request, messageCreateSchema);
    const now = new Date();

    const message = await prisma.message.create({
      data: {
        threadId,
        userId: user.id,
        role: body.role ?? "user",
        content: body.content,
      },
      select: {
        id: true,
        threadId: true,
        userId: true,
        role: true,
        content: true,
        createdAt: true,
      },
    });

    const title = thread.title === "New thread" && body.role === "user" ? deriveThreadTitleFromContent(body.content) : thread.title;

    await prisma.thread.update({
      where: {
        id: thread.id,
      },
      data: {
        title,
        updatedAt: now,
      },
    });

    return NextResponse.json({ message }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
