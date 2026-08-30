import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { createSessionToken, SESSION_COOKIE, SESSION_COOKIE_MAX_AGE } from "@/lib/auth/session";
import { getMembershipsForUser } from "@/lib/tenant-db";

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = LoginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a valid email and password." }, { status: 400 });
  }

  const { email, password } = parsed.data;
  const user = await db.user.findUnique({ where: { email } });

  // Same error for "no such user" and "wrong password" — don't leak which one it was.
  const invalidCredentials = () => NextResponse.json({ error: "Incorrect email or password." }, { status: 401 });

  if (!user) return invalidCredentials();
  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) return invalidCredentials();

  const memberships = await getMembershipsForUser(user.id);
  if (memberships.length === 0) {
    return NextResponse.json({ error: "This account has no organization. Contact support." }, { status: 403 });
  }
  const organizationId = memberships[0].organizationId;

  const token = await createSessionToken({ userId: user.id, organizationId });

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
