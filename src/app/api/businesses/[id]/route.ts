import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getBusinessInOrg, withOrgScope } from "@/lib/tenant-db";

const UpdateSchema = z.object({
  name: z.string().trim().min(1, "Enter a business name.").max(120),
  industry: z.string().trim().max(120).nullable().optional(),
});

/** Renames a business (and optionally edits its industry). Its id, leads and connections are unaffected. */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!["owner", "admin"].includes(user.role)) {
    return NextResponse.json({ error: "Only owners and admins can edit a business." }, { status: 403 });
  }

  const { id: businessId } = await context.params;
  const business = await getBusinessInOrg(user.organizationId, businessId);
  if (!business) return NextResponse.json({ error: "Business not found." }, { status: 404 });

  const parsed = UpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid details." }, { status: 400 });
  }

  const updated = await withOrgScope(user.organizationId, (tx) =>
    tx.business.update({
      where: { id: businessId },
      data: {
        name: parsed.data.name,
        ...(parsed.data.industry !== undefined ? { industry: parsed.data.industry || null } : {}),
      },
    })
  );
  return NextResponse.json({ business: updated });
}
