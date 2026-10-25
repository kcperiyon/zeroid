import { cookies, headers } from "next/headers";
import { timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { getMembership } from "@/lib/tenant-db";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth/session";

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

/**
 * Neutron Brain's own-account access: a long-lived bearer token (NEUTRON_BRAIN_API_KEY) that
 * resolves to exactly the owner's existing user+org membership (NEUTRON_BRAIN_OWNER_EMAIL) -
 * never a separate superuser identity, never broader than that one account's real permissions.
 * Checked first, falls through to normal session-cookie auth when absent - purely additive.
 */
async function getUserFromApiKey() {
  const apiKey = process.env.NEUTRON_BRAIN_API_KEY;
  const ownerEmail = process.env.NEUTRON_BRAIN_OWNER_EMAIL;
  if (!apiKey || !ownerEmail) return null;

  const headerStore = await headers();
  const auth = headerStore.get("authorization");
  if (!auth || !auth.startsWith("Bearer ")) return null;
  const presented = auth.slice("Bearer ".length).trim();
  if (!presented || !safeEqual(presented, apiKey)) return null;

  const user = await db.user.findUnique({ where: { email: ownerEmail } });
  if (!user) return null;
  // Resolve the owner's actual org the normal way (first membership) rather than trusting an
  // env var for organizationId too - one less thing that can silently drift out of sync.
  const membership = await db.orgMembership.findFirst({ where: { userId: user.id } });
  if (!membership) return null;

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    organizationId: membership.organizationId,
    role: membership.role,
  };
}

/**
 * Server-only. Returns null if there's no valid session or the session's
 * organization no longer counts the user as a member (e.g. removed after the
 * token was issued) — callers decide whether that's a redirect or a 401.
 * The membership lookup itself is RLS-scoped (see getMembership), so this
 * function can never return a role for an org the user doesn't belong to.
 */
export async function getCurrentUser() {
  const viaApiKey = await getUserFromApiKey();
  if (viaApiKey) return viaApiKey;

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
