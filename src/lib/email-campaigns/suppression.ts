import type { Prisma } from "@/generated/prisma/client";

type Tx = Prisma.TransactionClient;

export const normaliseEmail = (email: string) => email.trim().toLowerCase();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const looksLikeEmail = (email: string) => EMAIL_RE.test(email.trim()) && email.length <= 254;

/**
 * Is this address blocked from receiving campaign email? Checks both the platform-wide list
 * (businessId NULL: hard bounces, complaints, never-email-me requests) and this business own list.
 * Row-level security already limits a business to those two scopes.
 */
export async function findSuppression(tx: Tx, businessId: string, email: string) {
  return tx.suppression.findFirst({
    where: { email: normaliseEmail(email), OR: [{ businessId: null }, { businessId }] },
    select: { reason: true, businessId: true },
  });
}

/** Adds a suppression (idempotent). businessId null = platform-wide. */
export async function addSuppression(
  tx: Tx,
  args: { businessId: string | null; email: string; reason: "unsubscribe" | "hard_bounce" | "complaint" | "manual" | "global_optout"; source?: string }
) {
  const email = normaliseEmail(args.email);
  const existing = await tx.suppression.findFirst({ where: { email, businessId: args.businessId } });
  if (existing) return existing;
  return tx.suppression.create({ data: { email, businessId: args.businessId, reason: args.reason, source: args.source } });
}
