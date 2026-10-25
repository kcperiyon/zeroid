import { NextResponse } from "next/server";
import { authorizeBusiness, CAMPAIGN_ROLES } from "@/lib/api-auth";
import { pauseCampaign } from "@/lib/email-campaigns/engine";

export async function POST(_request: Request, context: { params: Promise<{ id: string; campaignId: string }> }) {
  const auth = await authorizeBusiness(context, CAMPAIGN_ROLES);
  if ("error" in auth) return auth.error;
  const { campaignId } = await context.params;
  await pauseCampaign(auth.user.organizationId, auth.businessId, campaignId);
  return NextResponse.json({ ok: true });
}
