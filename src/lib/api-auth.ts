import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getBusinessInOrg } from "@/lib/tenant-db";

type Role = "owner" | "admin" | "manager" | "sales" | "marketing" | "viewer";

/**
 * Shared guard for business-scoped API routes: signed in, role allowed, business belongs to the
 * caller organisation. Returns either the context or a ready-made error response.
 */
export async function authorizeBusiness(
  context: { params: Promise<{ id: string }> },
  allowed: Role[]
): Promise<{ error: NextResponse } | { user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>; businessId: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: NextResponse.json({ error: "Not signed in." }, { status: 401 }) };
  if (!allowed.includes(user.role as Role)) {
    return { error: NextResponse.json({ error: "You do not have permission to do that." }, { status: 403 }) };
  }
  const { id: businessId } = await context.params;
  const business = await getBusinessInOrg(user.organizationId, businessId);
  if (!business) return { error: NextResponse.json({ error: "Business not found." }, { status: 404 }) };
  return { user, businessId };
}

export const CAMPAIGN_ROLES: Role[] = ["owner", "admin", "manager", "marketing"];
