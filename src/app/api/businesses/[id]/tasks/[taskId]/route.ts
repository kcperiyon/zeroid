import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getBusinessInOrg, withBusinessScope } from "@/lib/tenant-db";

const UpdateTaskSchema = z.object({ status: z.enum(["open", "done"]) });

export async function PATCH(request: Request, context: { params: Promise<{ id: string; taskId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id: businessId, taskId } = await context.params;
  const business = await getBusinessInOrg(user.organizationId, businessId);
  if (!business) return NextResponse.json({ error: "Business not found." }, { status: 404 });

  const body = await request.json().catch(() => null);
  const parsed = UpdateTaskSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid update." }, { status: 400 });

  const task = await withBusinessScope(user.organizationId, businessId, async (tx) => {
    const existing = await tx.task.findFirst({ where: { id: taskId, businessId } });
    if (!existing) return null;
    return tx.task.update({ where: { id: taskId }, data: { status: parsed.data.status } });
  });

  if (!task) return NextResponse.json({ error: "Task not found." }, { status: 404 });
  return NextResponse.json({ task });
}
