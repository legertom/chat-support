import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError, jsonError, parsePaginationCursor } from "@/lib/http";
import { parseJsonBody } from "@/lib/request";
import { requireDbUser } from "@/lib/server-auth";
import { createThreadSchema, threadScopeSchema } from "@/lib/validators";
import { DEFAULT_THREAD_TITLE } from "@/lib/threads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await requireDbUser();
    const url = new URL(request.url);
    const scopeRaw = url.searchParams.get("scope") ?? "all";
    const parsedScope = threadScopeSchema.safeParse(scopeRaw);
    if (!parsedScope.success) {
      throw new ApiError(400, "Invalid scope. Use 'all' or 'mine'.", "invalid_scope");
    }

    const limitRaw = url.searchParams.get("limit");
    const limitParsed = Number.parseInt(limitRaw ?? "20", 10);
    const limit = Number.isFinite(limitParsed) ? Math.max(1, Math.min(50, limitParsed)) : 20;

    const scope = parsedScope.data;
    const cursor = parsePaginationCursor(url.searchParams.get("cursor"));

    const where =
      scope === "mine"
        ? {
            OR: [
              { createdByUserId: user.id },
              {
                participants: {
                  some: {
                    userId: user.id,
                  },
                },
              },
            ],
          }
        : {
            OR: [
              {
                visibility: "org" as const,
              },
              {
                createdByUserId: user.id,
              },
              {
                participants: {
                  some: {
                    userId: user.id,
                  },
                },
              },
            ],
          };

    const threads = await prisma.thread.findMany({
      where,
      take: limit + 1,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      include: {
        createdBy: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
        messages: {
          take: 1,
          orderBy: {
            createdAt: "desc",
          },
          select: {
            id: true,
            role: true,
            content: true,
            createdAt: true,
          },
        },
        _count: {
          select: {
            messages: true,
          },
        },
      },
    });

    const hasMore = threads.length > limit;
    const items = hasMore ? threads.slice(0, limit) : threads;

    return NextResponse.json({
      items: items.map((thread) => ({
        id: thread.id,
        title: thread.title,
        visibility: thread.visibility,
        createdAt: thread.createdAt,
        updatedAt: thread.updatedAt,
        createdBy: thread.createdBy,
        messageCount: thread._count.messages,
        lastMessage: thread.messages[0]
          ? {
              id: thread.messages[0].id,
              role: thread.messages[0].role,
              contentPreview: thread.messages[0].content.slice(0, 180),
              createdAt: thread.messages[0].createdAt,
            }
          : null,
      })),
      nextCursor: hasMore ? items[items.length - 1]?.id ?? null : null,
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireDbUser();
    const body = await parseJsonBody(request, createThreadSchema);

    const title = body.title?.trim() || DEFAULT_THREAD_TITLE;
    const visibility = body.visibility ?? "org";

    const thread = await prisma.thread.create({
      data: {
        title,
        visibility,
        createdByUserId: user.id,
      },
      select: {
        id: true,
        title: true,
        visibility: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({ thread }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
