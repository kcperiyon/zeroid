import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getBusinessInOrg, withBusinessScope } from "@/lib/tenant-db";

const CreateProductSchema = z.object({
  name: z.string().min(1).max(160),
  description: z.string().max(2000).optional(),
  price: z.number().nonnegative().optional(),
  currency: z.string().length(3).optional(),
});

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id: businessId } = await context.params;
  const business = await getBusinessInOrg(user.organizationId, businessId);
  if (!business) return NextResponse.json({ error: "Business not found." }, { status: 404 });

  const products = await withBusinessScope(user.organizationId, businessId, (tx) =>
    tx.product.findMany({ where: { businessId }, orderBy: { createdAt: "asc" } })
  );
  return NextResponse.json({ products });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  if (!["owner", "admin", "manager"].includes(user.role)) {
    return NextResponse.json({ error: "You don't have permission to add products." }, { status: 403 });
  }

  const { id: businessId } = await context.params;
  const business = await getBusinessInOrg(user.organizationId, businessId);
  if (!business) return NextResponse.json({ error: "Business not found." }, { status: 404 });

  const body = await request.json().catch(() => null);
  const parsed = CreateProductSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid product details." },
      { status: 400 }
    );
  }

  const product = await withBusinessScope(user.organizationId, businessId, (tx) =>
    tx.product.create({
      data: {
        businessId,
        name: parsed.data.name,
        description: parsed.data.description,
        price: parsed.data.price,
        currency: parsed.data.currency ?? "USD",
      },
    })
  );
  return NextResponse.json({ product }, { status: 201 });
}
