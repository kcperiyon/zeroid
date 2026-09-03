import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getBusinessInOrg, withBusinessScope } from "@/lib/tenant-db";
import { detectTechStack } from "@/lib/prospecting/tech-stack";

const CheckSchema = z.object({
  url: z.string().min(1).max(300),
  name: z.string().max(160).optional(),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  if (!["owner", "admin", "manager"].includes(user.role)) {
    return NextResponse.json({ error: "You don't have permission to check websites." }, { status: 403 });
  }

  const { id: businessId } = await context.params;
  const business = await getBusinessInOrg(user.organizationId, businessId);
  if (!business) return NextResponse.json({ error: "Business not found." }, { status: 404 });

  const body = await request.json().catch(() => null);
  const parsed = CheckSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid URL." }, { status: 400 });
  }

  let techStack: string[];
  try {
    techStack = await detectTechStack(parsed.data.url);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not check that website.";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const website = parsed.data.url.startsWith("http") ? parsed.data.url : `https://${parsed.data.url}`;
  const prospect = await withBusinessScope(user.organizationId, businessId, (tx) =>
    tx.prospect.upsert({
      where: { businessId_channel_externalId: { businessId, channel: "manual", externalId: website } },
      update: { category: techStack.length > 0 ? techStack.join(", ") : "No known tools detected" },
      create: {
        businessId,
        channel: "manual",
        externalId: website,
        name: parsed.data.name || website,
        website,
        category: techStack.length > 0 ? techStack.join(", ") : "No known tools detected",
      },
    })
  );

  return NextResponse.json({ prospect, techStack }, { status: 201 });
}
