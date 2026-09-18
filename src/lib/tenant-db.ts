import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";

type Tx = Prisma.TransactionClient;

/**
 * Every tenant-scoped query must go through withOrgScope or withBusinessScope,
 * never a bare `db.<model>.*` call for a tenant table. This is the app-level
 * half of the two-layer isolation described in docs/build-spec.md §5 — it sets
 * the Postgres session variable each RLS policy checks, inside the same
 * transaction the query runs in, so a query that forgets its own WHERE clause
 * still can't see another tenant's rows.
 */
export async function withOrgScope<T>(
  organizationId: string,
  fn: (tx: Tx) => Promise<T>
): Promise<T> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.organization_id', ${organizationId}, true)`;
    return fn(tx);
  });
}

export async function withBusinessScope<T>(
  organizationId: string,
  businessId: string,
  fn: (tx: Tx) => Promise<T>
): Promise<T> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.organization_id', ${organizationId}, true)`;
    await tx.$executeRaw`SELECT set_config('app.business_id', ${businessId}, true)`;
    return fn(tx);
  });
}

/** Looks up a membership scoped to the claimed org — returns null if the user isn't a member. */
export async function getMembership(organizationId: string, userId: string) {
  return withOrgScope(organizationId, (tx) =>
    tx.orgMembership.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
    })
  );
}

/**
 * Scopes a transaction to "rows this specific user is allowed to see about
 * themselves" rather than to one organization — see the OrgMembership RLS
 * policy's self-lookup clause. Only usable after identity is already
 * verified (e.g. password check passed), since it's what lets login find
 * which org(s) to offer without knowing organizationId up front.
 */
export async function withUserScope<T>(
  userId: string,
  fn: (tx: Tx) => Promise<T>
): Promise<T> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.user_id', ${userId}, true)`;
    return fn(tx);
  });
}

/** All orgs a user belongs to, oldest first — login defaults to the first one. */
export async function getMembershipsForUser(userId: string) {
  return withUserScope(userId, (tx) =>
    tx.orgMembership.findMany({
      where: { userId },
      include: { organization: true },
      orderBy: { createdAt: "asc" },
    })
  );
}

/** Looks up a business scoped to the claimed org — returns null if it doesn't belong there. */
export async function getBusinessInOrg(organizationId: string, businessId: string) {
  return withOrgScope(organizationId, (tx) =>
    tx.business.findFirst({ where: { id: businessId, organizationId } })
  );
}

/**
 * Scopes a transaction to one invite by token — the token itself is the
 * authorization (see the Invite RLS policy), which is what lets an
 * unauthenticated invite-acceptance page look up "the invite with this
 * token" before the invitee has any account or org membership at all.
 */
export async function withInviteTokenScope<T>(
  token: string,
  fn: (tx: Tx) => Promise<T>
): Promise<T> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.invite_token', ${token}, true)`;
    return fn(tx);
  });
}

/**
 * Scopes a transaction to one WhatsAppConnection by phoneNumberId — same
 * chicken-and-egg shape as withInviteTokenScope: the WhatsApp webhook gets
 * Meta's phone_number_id in the payload before it knows which business (or
 * even which organization) owns that number, so there's no app.business_id
 * to set yet. This is the only lookup app.phone_number_id authorizes.
 */
export async function withPhoneNumberIdScope<T>(
  phoneNumberId: string,
  fn: (tx: Tx) => Promise<T>
): Promise<T> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.phone_number_id', ${phoneNumberId}, true)`;
    return fn(tx);
  });
}
