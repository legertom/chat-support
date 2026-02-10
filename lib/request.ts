import type { ZodTypeAny, infer as ZodInfer } from "zod";
import { ApiError } from "@/lib/http";

export async function parseJsonBody<TSchema extends ZodTypeAny>(
  request: Request,
  schema: TSchema
): Promise<ZodInfer<TSchema>> {
  let json: unknown;

  try {
    json = await request.json();
  } catch {
    throw new ApiError(400, "Invalid JSON body", "invalid_json");
  }

  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    throw new ApiError(400, firstIssue?.message ?? "Invalid request body", "invalid_body");
  }

  return parsed.data;
}
