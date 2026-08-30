import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { createSessionToken, SESSION_COOKIE, SESSION_COOKIE_MAX_AGE } from "@/lib/auth/session";
import { slugify } from "@/lib/slug";

const SignupSchema = z.object({
  organizationName: z.string().min(2).max(120),
  name: z.string().min(1).max(120),
  email: z.string().email(),
  password: z.string().min(8).max(200),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = SignupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid signup details." },
      { status: 400 }
    );
  }
  const { organizationName, name, email, password } = parsed.data;

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: "An account with that email already exists." }, { status: 409 });
  }

  const passwordHash = await hashPassword(password);
  const baseSlug = slugify(organizationName) || "org";

  let organization;
  try {
    organization = await db.$transaction(async (tx) => {
      // Slug collisions: try the base slug, then a few numbered variants.
      // Good enough for Phase 1 volume — not a high-contention path.
      let slug = baseSlug;
      for (let attempt = 0; attempt < 5; attempt++) {
        const clash = await tx.organization.findUnique({ where: { slug } });
        if (!clash) break;
        slug = `${baseSlug}-${attempt + 2}`;
      }

      const org = await tx.organization.create({ data: { name: organizationName, slug } });
      const user = await tx.user.create({ data: { email, name, passwordHash } });

      // From here on we're creating rows in RLS-protected tables — scope the
      // transaction to the org we just created so the WITH CHECK clause passes.
      await tx.$executeRaw`SELECT set_config('app.organization_id', ${org.id}, true)`;

      await tx.orgMembership.create({
        data: { organizationId: org.id, userId: user.id, role: "owner" },
      });
      await tx.subscription.create({ data: { organizationId: org.id } });
      await tx.aiCreditWallet.create({ data: { organizationId: org.id, balance: 0 } });

      return { id: org.id, userId: user.id };
    });
  } catch {
    return NextResponse.json({ error: "Could not create account. Try again." }, { status: 500 });
  }

  const token = await createSessionToken({ userId: organization.userId, organizationId: organization.id });

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
