import { NextResponse } from "next/server";
import { z } from "zod";
import { withBusinessScope } from "@/lib/tenant-db";
import { authorizeBusiness } from "@/lib/api-auth";
import { importProspectAsLead } from "@/lib/prospect-import";
import { looksLikeEmail } from "@/lib/email-campaigns/suppression";

const Schema = z.object({
  // Import only prospects that already have a usable email address (default), or every new prospect.
  onlyWithEmail: z.boolean().default(true),
  channels: z.array(z.string().max(40)).max(20).optional(),
  limit: z.number().int().min(1).max(1000).default(500),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeBusiness(context, ["owner", "admin", "manager"]);
  if ("error" in auth) return auth.error;
  const parsed = Schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const { onlyWithEmail, channels, limit } = parsed.data;

  const result = await withBusinessScope(auth.user.organizationId, auth.businessId, async (tx) => {
    const candidates = await tx.prospect.findMany({
      where: { businessId: auth.businessId, status: "new", ...(channels?.length ? { channel: { in: channels as never[] } } : {}) },
      orderBy: { createdAt: "asc" },
      take: limit,
    });
    let imported = 0;
    let skippedNoEmail = 0;
    for (const p of candidates) {
      if (onlyWithEmail && !(p.email && looksLikeEmail(p.email))) {
        skippedNoEmail++;
        continue;
      }
      await importProspectAsLead(tx, auth.businessId, p.id);
      imported++;
    }
    return { imported, skippedNoEmail, considered: candidates.length };
  });
  return NextResponse.json(result);
}
