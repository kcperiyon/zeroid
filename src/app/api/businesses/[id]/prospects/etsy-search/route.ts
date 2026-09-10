import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getBusinessInOrg, withBusinessScope } from "@/lib/tenant-db";
import { searchEtsyShops } from "@/lib/prospecting/etsy";

const SearchSchema = z.object({ query: z.string().min(1).max(200) });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  if (!["owner", "admin", "manager"].includes(user.role)) {
    return NextResponse.json({ error: "You don't have permission to search for prospects." }, { status: 403 });
  }

  const { id: businessId } = await context.params;
  const business = await getBusinessInOrg(user.organizationId, businessId);
  if (!business) return NextResponse.json({ error: "Business not found." }, { status: 404 });

  const body = await request.json().catch(() => null);
  const parsed = SearchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid search." }, { status: 400 });
  }

  let results;
  try {
    results = await searchEtsyShops(parsed.data.query);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not reach Etsy.";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const prospects = await withBusinessScope(user.organizationId, businessId, async (tx) => {
    const rows = [];
    for (const shop of results) {
      const row = await tx.prospect.upsert({
        where: { businessId_channel_externalId: { businessId, channel: "etsy", externalId: shop.externalId } },
        update: { name: shop.name, website: shop.website, category: shop.category },
        create: {
          businessId,
          channel: "etsy",
          externalId: shop.externalId,
          name: shop.name,
          website: shop.website,
          category: shop.category,
        },
      });
      rows.push(row);
    }
    return rows;
  });

  return NextResponse.json({ prospects }, { status: 201 });
}
