import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getBusinessInOrg, withBusinessScope } from "@/lib/tenant-db";

const newKey = () => randomBytes(18).toString("base64url");

/** Creates the business's lead-capture key, or replaces it (the old form/webhook URLs stop working). */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!["owner", "admin"].includes(user.role)) {
    return NextResponse.json({ error: "Only an owner or admin can manage lead capture." }, { status: 403 });
  }

  const { id: businessId } = await context.params;
  const business = await getBusinessInOrg(user.organizationId, businessId);
  if (!business) return NextResponse.json({ error: "Business not found." }, { status: 404 });

  const publicKey = newKey();
  await withBusinessScope(user.organizationId, businessId, (tx) =>
    tx.intakeKey.upsert({
      where: { businessId },
      update: { publicKey },
      create: { businessId, organizationId: user.organizationId, publicKey },
    })
  );
  return NextResponse.json({ publicKey }, { status: 201 });
}
