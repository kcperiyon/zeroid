import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeBusiness, CAMPAIGN_ROLES } from "@/lib/api-auth";
import { setJobStatus } from "@/lib/discovery/runner";

const Schema = z.object({ action: z.enum(["pause", "resume", "cancel"]) });

export async function POST(request: Request, context: { params: Promise<{ id: string; jobId: string }> }) {
  const auth = await authorizeBusiness(context, CAMPAIGN_ROLES);
  if ("error" in auth) return auth.error;
  const parsed = Schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  const { jobId } = await context.params;
  const job = await setJobStatus(auth.user.organizationId, auth.businessId, jobId, parsed.data.action);
  if (!job) return NextResponse.json({ error: "Search not found." }, { status: 404 });
  return NextResponse.json({ job });
}
