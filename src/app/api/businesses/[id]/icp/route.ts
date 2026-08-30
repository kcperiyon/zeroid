import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getBusinessInOrg, withBusinessScope } from "@/lib/tenant-db";

const CreateIcpSchema = z.object({
  name: z.string().min(1).max(120),
  location: z.string().max(160).optional(),
  industry: z.string().max(160).optional(),
  companySize: z.string().max(80).optional(),
  budget: z.string().max(80).optional(),
  problems: z.string().max(2000).optional(),
  notes: z.string().max(2000).optional(),
});

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id: businessId } = await context.params;
  const business = await getBusinessInOrg(user.organizationId, businessId);
  if (!business) return NextResponse.json({ error: "Business not found." }, { status: 404 });

  const icpProfiles = await withBusinessScope(user.organizationId, businessId, (tx) =>
    tx.icpProfile.findMany({ where: { businessId }, orderBy: { createdAt: "asc" } })
  );
  return NextResponse.json({ icpProfiles });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  if (!["owner", "admin", "manager"].includes(user.role)) {
    return NextResponse.json({ error: "You don't have permission to edit the ICP." }, { status: 403 });
  }

  const { id: businessId } = await context.params;
  const business = await getBusinessInOrg(user.organizationId, businessId);
  if (!business) return NextResponse.json({ error: "Business not found." }, { status: 404 });

  const body = await request.json().catch(() => null);
  const parsed = CreateIcpSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid ICP details." },
      { status: 400 }
    );
  }

  const { name, ...attributes } = parsed.data;
  const icpProfile = await withBusinessScope(user.organizationId, businessId, (tx) =>
    tx.icpProfile.create({
      data: { businessId, name, attributes, source: "manual" },
    })
  );
  return NextResponse.json({ icpProfile }, { status: 201 });
}
