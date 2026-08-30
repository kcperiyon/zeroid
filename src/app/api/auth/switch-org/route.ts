import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createSessionToken, SESSION_COOKIE, SESSION_COOKIE_MAX_AGE } from "@/lib/auth/session";
import { getMembershipsForUser } from "@/lib/tenant-db";

const SwitchSchema = z.object({ organizationId: z.string().min(1) });

/** Re-issues the session cookie pointed at a different org this user is actually a member of. */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = SwitchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  const memberships = await getMembershipsForUser(user.id);
  const target = memberships.find((m) => m.organizationId === parsed.data.organizationId);
  if (!target) return NextResponse.json({ error: "You're not a member of that organization." }, { status: 403 });

  const token = await createSessionToken({ userId: user.id, organizationId: target.organizationId });
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_COOKIE_MAX_AGE,
  });
  return response;
}
