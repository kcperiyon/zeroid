import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getBusinessInOrg, withBusinessScope } from "@/lib/tenant-db";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id: businessId } = await context.params;
  const business = await getBusinessInOrg(user.organizationId, businessId);
  if (!business) return NextResponse.json({ error: "Business not found." }, { status: 404 });

  const includeDone = new URL(request.url).searchParams.get("all") === "1";

  const tasks = await withBusinessScope(user.organizationId, businessId, (tx) =>
    tx.task.findMany({
      where: { businessId, ...(includeDone ? {} : { status: "open" }) },
      include: { lead: { select: { id: true, name: true, email: true, phone: true } } },
      orderBy: { createdAt: "desc" },
    })
  );
  return NextResponse.json({ tasks });
}
