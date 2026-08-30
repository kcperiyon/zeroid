import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { getMembership } from "@/lib/tenant-db";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth/session";

/**
 * Server-only. Returns null if there's no valid session or the session's
 * organization no longer counts the user as a member (e.g. removed after the
 * token was issued) — callers decide whether that's a redirect or a 401.
 * The membership lookup itself is RLS-scoped (see getMembership), so this
 * function can never return a role for an org the user doesn't belong to.
 */
export async function getCurrentUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const payload = await verifySessionToken(token);
  if (!payload) return null;

  const user = await db.user.findUnique({ where: { id: payload.userId } });
  if (!user) return null;

  const membership = await getMembership(payload.organizationId, user.id);
  if (!membership) return null;

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    organizationId: payload.organizationId,
    role: membership.role,
  };
}
