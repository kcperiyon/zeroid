import { NextResponse } from "next/server";
import { z } from "zod";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { createSessionToken, SESSION_COOKIE, SESSION_COOKIE_MAX_AGE, verifySessionToken } from "@/lib/auth/session";
import { withInviteTokenScope, withOrgScope } from "@/lib/tenant-db";

const AcceptSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  password: z.string().min(8).max(200).optional(),
});

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const body = await request.json().catch(() => null);
  const parsed = AcceptSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  const invite = await withInviteTokenScope(token, (tx) => tx.invite.findUnique({ where: { token } }));
  if (!invite) return NextResponse.json({ error: "Invite not found." }, { status: 404 });
  if (invite.status !== "pending") {
    return NextResponse.json({ error: "This invite has already been used or revoked." }, { status: 410 });
  }

  const existingUser = await db.user.findUnique({ where: { email: invite.email } });

  let userId: string;

  if (existingUser) {
    // Already have an account — must already be signed in as that account.
    // We don't re-verify a password here; a fresh login is what proves identity.
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get(SESSION_COOKIE)?.value;
    const session = sessionToken ? await verifySessionToken(sessionToken) : null;
    if (!session || session.userId !== existingUser.id) {
      return NextResponse.json(
        { error: `An account with ${invite.email} already exists. Log in as that account, then open this invite link again.` },
        { status: 409 }
      );
    }
    userId = existingUser.id;
  } else {
    if (!parsed.data.name || !parsed.data.password) {
      return NextResponse.json({ error: "Name and password are required to create your account." }, { status: 400 });
    }
    const passwordHash = await hashPassword(parsed.data.password);
    const created = await db.user.create({
      data: { email: invite.email, name: parsed.data.name, passwordHash },
    });
    userId = created.id;
  }

  await withOrgScope(invite.organizationId, async (tx) => {
    await tx.orgMembership.create({
      data: { organizationId: invite.organizationId, userId, role: invite.role },
    });
    await tx.invite.update({ where: { id: invite.id }, data: { status: "accepted" } });
  });

  const newToken = await createSessionToken({ userId, organizationId: invite.organizationId });
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, newToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_COOKIE_MAX_AGE,
  });
  return response;
}
