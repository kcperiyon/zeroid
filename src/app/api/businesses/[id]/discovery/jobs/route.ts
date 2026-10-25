import { NextResponse } from "next/server";
import { z } from "zod";
import { withBusinessScope } from "@/lib/tenant-db";
import { authorizeBusiness, CAMPAIGN_ROLES } from "@/lib/api-auth";
import { resolveIndustry } from "@/lib/discovery/industries";
import { createJob, SOURCES } from "@/lib/discovery/runner";
import { listJobsWithCounts } from "@/lib/discovery/jobs-view";

const CreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  industries: z.array(z.string().trim().min(1).max(60)).min(1).max(10),
  locations: z.array(z.string().trim().min(2).max(120)).min(1).max(10),
  sources: z.array(z.enum(SOURCES)).min(1).default(["osm"]),
  maxProspects: z.number().int().min(1).max(2000).default(300),
  maxCells: z.number().int().min(1).max(500).default(120),
  autoEnrich: z.boolean().default(true),
});

const MAX_ACTIVE_JOBS = 3;

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeBusiness(context, CAMPAIGN_ROLES);
  if ("error" in auth) return auth.error;
  const data = await withBusinessScope(auth.user.organizationId, auth.businessId, (tx) => listJobsWithCounts(tx, auth.businessId));
  return NextResponse.json({ jobs: data });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeBusiness(context, CAMPAIGN_ROLES);
  if ("error" in auth) return auth.error;
  const parsed = CreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid search." }, { status: 400 });
  const d = parsed.data;
  const bad = d.industries.find((i) => !resolveIndustry(i));
  if (bad) return NextResponse.json({ error: `"${bad}" is not a known industry. Pick from the list, or use osm:key=value.` }, { status: 400 });

  const active = await withBusinessScope(auth.user.organizationId, auth.businessId, (tx) =>
    tx.discoveryJob.count({ where: { businessId: auth.businessId, status: { in: ["planning", "running", "paused"] } } })
  );
  if (active >= MAX_ACTIVE_JOBS) {
    return NextResponse.json({ error: `You already have ${active} searches in progress. Let one finish, or cancel one, before starting another.` }, { status: 409 });
  }
  const job = await createJob(auth.user.organizationId, auth.businessId, { ...d, sources: [...new Set(d.sources)] });
  return NextResponse.json({ job }, { status: 201 });
}
