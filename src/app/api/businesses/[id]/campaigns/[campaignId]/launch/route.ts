import { NextResponse } from "next/server";
import { authorizeBusiness, CAMPAIGN_ROLES } from "@/lib/api-auth";
import { CampaignError, launchCampaign } from "@/lib/email-campaigns/engine";

/** Starts (or resumes) a campaign. Whether anything is actually delivered is decided by the sandbox guard at send time. */
export async function POST(_request: Request, context: { params: Promise<{ id: string; campaignId: string }> }) {
  const auth = await authorizeBusiness(context, CAMPAIGN_ROLES);
  if ("error" in auth) return auth.error;
  const { campaignId } = await context.params;
  try {
    const result = await launchCampaign(auth.user.organizationId, auth.businessId, campaignId);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof CampaignError) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error("launch failed", error);
    return NextResponse.json({ error: "Could not start the campaign." }, { status: 500 });
  }
}
