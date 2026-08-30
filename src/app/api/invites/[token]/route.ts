import { NextResponse } from "next/server";
import { withInviteTokenScope } from "@/lib/tenant-db";

export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;

  const invite = await withInviteTokenScope(token, (tx) =>
    tx.invite.findUnique({
      where: { token },
      include: { organization: { select: { name: true } } },
    })
  );
  if (!invite) return NextResponse.json({ error: "Invite not found." }, { status: 404 });
  if (invite.status !== "pending") {
    return NextResponse.json({ error: "This invite has already been used or revoked." }, { status: 410 });
  }

  return NextResponse.json({
    email: invite.email,
    role: invite.role,
    organizationName: invite.organization.name,
  });
}
