import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";

/** Saved filter over a business leads. Everything is optional; an empty filter means every lead with an email. */
export const SegmentFilterSchema = z.object({
  channels: z.array(z.string().min(1).max(40)).max(20).optional(),
  stages: z.array(z.string().min(1).max(40)).max(20).optional(),
  medium: z.enum(["organic", "paid"]).optional(),
  minScore: z.number().int().min(0).max(100).optional(),
  maxScore: z.number().int().min(0).max(100).optional(),
  createdAfter: z.string().datetime().optional(),
  createdBefore: z.string().datetime().optional(),
  companyContains: z.string().trim().max(100).optional(),
  // Only leads whose address was scored at least this high by discovery (leads added by hand have no score and are excluded).
  minEmailConfidence: z.number().int().min(0).max(100).optional(),
});
export type SegmentFilter = z.infer<typeof SegmentFilterSchema>;

const STAGES = ["new", "contacted", "engaged", "qualified", "hot", "appointment", "proposal", "negotiation", "won", "lost"];
const CHANNELS = [
  "manual", "csv", "webhook", "whatsapp", "facebook", "instagram", "email", "google", "tiktok",
  "linkedin", "referral", "api", "news", "youtube", "etsy", "osm", "registry",
];

/** Turns a validated filter into a Prisma where clause. Always requires an email address. */
export function segmentWhere(businessId: string, filter: SegmentFilter): Prisma.LeadWhereInput {
  const and: Prisma.LeadWhereInput[] = [{ email: { not: null } }, { NOT: { email: "" } }];
  if (filter.channels?.length) {
    and.push({ source: { is: { channel: { in: filter.channels.filter((c) => CHANNELS.includes(c)) as never[] } } } });
  }
  if (filter.stages?.length) and.push({ stage: { in: filter.stages.filter((s) => STAGES.includes(s)) as never[] } });
  if (filter.medium) and.push({ medium: filter.medium });
  if (filter.minScore !== undefined) and.push({ leadScore: { gte: filter.minScore } });
  if (filter.maxScore !== undefined) and.push({ leadScore: { lte: filter.maxScore } });
  if (filter.createdAfter) and.push({ createdAt: { gte: new Date(filter.createdAfter) } });
  if (filter.createdBefore) and.push({ createdAt: { lte: new Date(filter.createdBefore) } });
  if (filter.companyContains) and.push({ company: { contains: filter.companyContains, mode: "insensitive" } });
  if (filter.minEmailConfidence !== undefined) and.push({ emailConfidence: { gte: filter.minEmailConfidence } });
  return { businessId, AND: and };
}

export function parseSegmentFilter(raw: unknown): SegmentFilter {
  const parsed = SegmentFilterSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : {};
}
