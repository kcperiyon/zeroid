import { NextResponse } from "next/server";
import { z } from "zod";
import { withBusinessScope } from "@/lib/tenant-db";
import { authorizeBusiness, CAMPAIGN_ROLES } from "@/lib/api-auth";
import { getSendThreshold } from "@/lib/discovery/store";
import type { Prisma } from "@/generated/prisma/client";

const Query = z.object({
  jobId: z.string().min(1).max(40).optional(),
  minConfidence: z.coerce.number().int().min(0).max(100).optional(),
  status: z.enum(["new", "imported", "dismissed"]).optional(),
  enrich: z.enum(["pending", "running", "done", "skipped", "failed"]).optional(),
  q: z.string().trim().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

type Signals = { existingLeadId?: string; people?: { name: string; title?: string }[] } | null;

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeBusiness(context, CAMPAIGN_ROLES);
  if ("error" in auth) return auth.error;
  const parsed = Query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Invalid filter." }, { status: 400 });
  const f = parsed.data;

  const where: Prisma.ProspectWhereInput = { businessId: auth.businessId, discoveryJobId: f.jobId ?? { not: null } };
  if (f.minConfidence !== undefined) where.bestEmailConfidence = { gte: f.minConfidence };
  if (f.status) where.status = f.status;
  if (f.enrich) where.enrichStatus = f.enrich;
  if (f.q) {
    where.OR = [
      { name: { contains: f.q, mode: "insensitive" } },
      { domain: { contains: f.q, mode: "insensitive" } },
      { address: { contains: f.q, mode: "insensitive" } },
    ];
  }

  const out = await withBusinessScope(auth.user.organizationId, auth.businessId, async (tx) => {
    const threshold = await getSendThreshold(tx, auth.businessId);
    const total = await tx.prospect.count({ where });
    const rows = await tx.prospect.findMany({
      where,
      orderBy: [{ bestEmailConfidence: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      take: f.limit,
      skip: f.offset,
      include: { emails: { orderBy: { confidence: "desc" }, take: 6 } },
    });
    return { threshold, total, rows };
  });

  return NextResponse.json({
    threshold: out.threshold,
    total: out.total,
    prospects: out.rows.map((p) => {
      const signals = p.signals as Signals;
      return {
        id: p.id, name: p.name, category: p.category, address: p.address, phone: p.phone, website: p.website, domain: p.domain,
        country: p.country, status: p.status, enrichStatus: p.enrichStatus, enrichError: p.enrichError, email: p.email,
        bestEmailConfidence: p.bestEmailConfidence, researchNote: p.researchNote,
        existingLeadId: signals?.existingLeadId ?? null,
        people: (signals?.people ?? []).slice(0, 6),
        emails: p.emails.map((e) => ({
          email: e.email, kind: e.kind, source: e.source, personName: e.personName, confidence: e.confidence, reasons: e.reasons, smtp: e.smtp,
        })),
      };
    }),
  });
}
