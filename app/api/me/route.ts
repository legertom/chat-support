import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { jsonError } from "@/lib/http";
import { parseJsonBody } from "@/lib/request";
import { requireDbUser } from "@/lib/server-auth";
import { updateProfileSchema } from "@/lib/validators";
import { getUserProfile } from "@/lib/user-stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const currentUser = await requireDbUser();
    const profile = await getUserProfile(currentUser.id);
    return NextResponse.json(profile);
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const currentUser = await requireDbUser();
    const body = await parseJsonBody(request, updateProfileSchema);

    const updatedUser = await prisma.user.update({
      where: {
        id: currentUser.id,
      },
      data: {
        name: body.name,
      },
      select: {
        id: true,
        email: true,
        name: true,
        image: true,
        role: true,
        status: true,
        createdAt: true,
        lastActiveAt: true,
      },
    });

    return NextResponse.json({
      user: updatedUser,
    });
  } catch (error) {
    return jsonError(error);
  }
}
