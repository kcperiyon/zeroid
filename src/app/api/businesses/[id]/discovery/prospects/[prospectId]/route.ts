import { NextResponse } from "next/server";
import { z } from "zod";
import { withBusinessScope } from "@/lib/tenant-db";
import { authorizeBusiness } from "@/lib/api-auth";
import { importProspectAsLead } from "@/lib/prospect-import";

const Schema = z.object({ action: z.enum(["import", "dismiss", "reenrich"]) });

export async function POST(request: Request, context: { params: Promise<{ id: string; prospectId: string }> }) {
  const auth = await authorizeBusiness(context, ["owner", "admin", "manager"]);
  if ("error" in auth) return auth.error;
  const parsed = Schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  const { prospectId } = await context.params;

  const result = await withBusinessScope(auth.user.organizationId, auth.businessId, async (tx) => {
    const p = await tx.prospect.findFirst({ where: { id: prospectId, businessId: auth.businessId } });
    if (!p) return null;
    if (parsed.data.action === "import") return importProspectAsLead(tx, auth.businessId, prospectId);
    if (parsed.data.action === "dismiss") {
      return tx.prospect.update({ where: { id: prospectId }, data: { status: p.status === "imported" ? p.status : "dismissed" } });
    }
    // Re-check: queue it again, but only if there is a site or an address to look at.
    if (!p.website && !p.email) return p;
    return tx.prospect.update({ where: { id: prospectId }, data: { enrichStatus: "pending", enrichAttempts: 0, enrichError: null } });
  });
  if (!result) return NextResponse.json({ error: "Prospect not found." }, { status: 404 });
  return NextResponse.json({ prospect: { id: result.id, status: result.status, enrichStatus: result.enrichStatus, leadId: result.leadId } });
}
