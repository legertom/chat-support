import { z } from "zod";

export const threadVisibilitySchema = z.enum(["org", "private"]);
export const retrievalSourceSchema = z.enum(["support", "dev"]);
export const apiKeyProviderSchema = z.enum(["openai", "anthropic", "gemini"]);

export const createThreadSchema = z.object({
  title: z.string().trim().max(120).optional(),
  visibility: threadVisibilitySchema.optional(),
});

export const createThreadMessageSchema = z.object({
  content: z.string().trim().min(1).max(20_000),
  sources: z.array(retrievalSourceSchema).min(1).max(2).optional(),
  modelId: z.string().trim().min(1).max(120).optional(),
  topK: z.number().int().min(2).max(10).optional(),
  temperature: z.number().min(0).max(1.2).optional(),
  maxOutputTokens: z.number().int().min(128).max(4096).optional(),
  userApiKeyId: z.string().trim().min(1).max(128).optional().nullable(),
});

export const chatRequestSchema = createThreadMessageSchema.extend({
  threadId: z.string().trim().min(1).max(128),
});

export const messageFeedbackSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(4000).optional().nullable(),
});

export const threadFeedbackSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(4000).optional().nullable(),
});

export const updateUserSchema = z
  .object({
    role: z.enum(["admin", "member"]).optional(),
    status: z.enum(["active", "disabled"]).optional(),
  })
  .refine((value) => value.role !== undefined || value.status !== undefined, {
    message: "At least one field is required.",
  });

export const updateProfileSchema = z.object({
  name: z.string().trim().min(1).max(120),
});

export const creditTopupSchema = z.object({
  amountCents: z.number().int().positive().max(5_000_000),
  reason: z.string().trim().max(500).optional().nullable(),
});

export const createInviteSchema = z.object({
  email: z.string().trim().email(),
  role: z.enum(["admin", "member"]).default("member"),
  initialCreditCents: z.number().int().nonnegative().max(5_000_000).optional(),
  expiresInDays: z.number().int().min(1).max(120).optional(),
});

export const updateInviteSchema = z.object({
  action: z.enum(["revoke", "resend"]),
  expiresInDays: z.number().int().min(1).max(120).optional(),
});

export const ingestionReviewSchema = z.object({
  status: z.enum(["approved", "rejected"]),
  note: z.string().trim().max(3000).optional().nullable(),
});

export const threadScopeSchema = z.enum(["all", "mine"]);

export const createUserApiKeySchema = z.object({
  provider: apiKeyProviderSchema,
  label: z.string().trim().min(1).max(60),
  apiKey: z.string().trim().min(8).max(1000),
});

export const updateUserApiKeySchema = z
  .object({
    provider: apiKeyProviderSchema.optional(),
    label: z.string().trim().min(1).max(60).optional(),
    apiKey: z.string().trim().min(8).max(1000).optional(),
  })
  .refine((value) => value.provider !== undefined || value.label !== undefined || value.apiKey !== undefined, {
    message: "At least one field is required.",
  });

export const byokMigrationSchema = z.object({
  dryRun: z.boolean().optional(),
  limit: z.number().int().min(1).max(1000).optional(),
  userId: z.string().trim().min(1).max(128).optional(),
});

export function parseOptionalString(value: string | null): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
