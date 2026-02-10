import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError, jsonError } from "@/lib/http";
import { parseJsonBody } from "@/lib/request";
import { requireAdminUser } from "@/lib/server-auth";
import { ingestionReviewSchema } from "@/lib/validators";
import { logAdminAction } from "@/lib/admin-audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdminUser();
    const { id: candidateId } = await context.params;
    const body = await parseJsonBody(request, ingestionReviewSchema);

    const candidate = await prisma.ingestionCandidate.findUnique({
      where: {
        id: candidateId,
      },
    });

    if (!candidate) {
      throw new ApiError(404, "Ingestion candidate not found", "candidate_not_found");
    }

    const now = new Date();
    const updatedCandidate = await prisma.ingestionCandidate.update({
      where: {
        id: candidateId,
      },
      data: {
        status: body.status,
        reviewedByUserId: admin.id,
        reviewedAt: now,
      },
    });

    await logAdminAction({
      actorUserId: admin.id,
      action: `admin.ingestion_candidate.${body.status}`,
      targetType: "ingestion_candidate",
      targetId: candidateId,
      metadata: {
        previousStatus: candidate.status,
        nextStatus: updatedCandidate.status,
        note: body.note ?? null,
      },
    });

    return NextResponse.json({ candidate: updatedCandidate });
  } catch (error) {
    return jsonError(error);
  }
}
