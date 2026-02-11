import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { jsonError } from "@/lib/http";
import { requireAdminUser } from "@/lib/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requireAdminUser();

    const url = new URL(request.url);
    const status = url.searchParams.get("status");

    const candidates = await prisma.ingestionCandidate.findMany({
      where:
        status === "approved" || status === "rejected" || status === "pending"
          ? { status }
          : undefined,
      orderBy: [{ createdAt: "desc" }],
      include: {
        createdBy: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
        reviewedBy: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
        thread: {
          select: {
            id: true,
            title: true,
          },
        },
        message: {
          select: {
            id: true,
            role: true,
            content: true,
            createdAt: true,
          },
        },
      },
    });

    return NextResponse.json({ candidates });
  } catch (error) {
    return jsonError(error);
  }
}
