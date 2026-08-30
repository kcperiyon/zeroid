import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current-user";
import { withOrgScope } from "@/lib/tenant-db";
import { DEFAULT_SCORING_WEIGHTS } from "@/lib/scoring";

const CreateBusinessSchema = z.object({
  name: z.string().min(1).max(120),
  industry: z.string().max(120).optional(),
});

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const businesses = await withOrgScope(user.organizationId, (tx) =>
    tx.business.findMany({
      where: { organizationId: user.organizationId },
      orderBy: { createdAt: "asc" },
    })
  );
  return NextResponse.json({ businesses });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  if (!["owner", "admin"].includes(user.role)) {
    return NextResponse.json({ error: "Only owners and admins can create businesses." }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = CreateBusinessSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid business details." },
      { status: 400 }
    );
  }

  const business = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.organization_id', ${user.organizationId}, true)`;
    const created = await tx.business.create({
      data: {
        organizationId: user.organizationId,
        name: parsed.data.name,
        industry: parsed.data.industry,
      },
    });

    // ScoringConfig is business-scoped — set app.business_id too before
    // inserting it, in the same transaction, so its RLS WITH CHECK passes.
    await tx.$executeRaw`SELECT set_config('app.business_id', ${created.id}, true)`;
    await tx.scoringConfig.create({
      data: { businessId: created.id, weights: DEFAULT_SCORING_WEIGHTS },
    });

    return created;
  });
  return NextResponse.json({ business }, { status: 201 });
}
