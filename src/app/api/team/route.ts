import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/current-user";
import { withOrgScope } from "@/lib/tenant-db";

const ROLES = ["owner", "admin", "manager", "sales", "marketing", "viewer"] as const;

const InviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(ROLES),
});

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { members, invites } = await withOrgScope(user.organizationId, async (tx) => {
    const [members, invites] = await Promise.all([
      tx.orgMembership.findMany({
        where: { organizationId: user.organizationId },
        include: { user: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: "asc" },
      }),
      tx.invite.findMany({
        where: { organizationId: user.organizationId, status: "pending" },
        orderBy: { createdAt: "desc" },
      }),
    ]);
    return { members, invites };
  });

  return NextResponse.json({ members, invites });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  if (!["owner", "admin"].includes(user.role)) {
    return NextResponse.json({ error: "Only owners and admins can invite members." }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = InviteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid invite." },
      { status: 400 }
    );
  }

  const existingUser = await withOrgScope(user.organizationId, (tx) =>
    tx.orgMembership.findFirst({
      where: { organizationId: user.organizationId, user: { email: parsed.data.email } },
    })
  );
  if (existingUser) {
    return NextResponse.json({ error: "That email is already on this team." }, { status: 409 });
  }

  const invite = await withOrgScope(user.organizationId, (tx) =>
    tx.invite.create({
      data: { organizationId: user.organizationId, email: parsed.data.email, role: parsed.data.role },
    })
  );

  return NextResponse.json({ invite }, { status: 201 });
}
