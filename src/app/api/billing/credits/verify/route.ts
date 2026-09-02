import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/current-user";
import { withOrgScope } from "@/lib/tenant-db";
import { verifyTransactionByRef } from "@/lib/payments/flutterwave";

const RequestSchema = z.object({ txRef: z.string().min(1) });

/**
 * The only place a credit purchase is ever actually credited. Never trusts
 * the redirect query params as proof — always re-verifies fresh against
 * Flutterwave by tx_ref, and checks the amount/currency Flutterwave reports
 * match what this specific purchase row expects, not just that some
 * "successful" transaction with this ref exists. Idempotent: calling this
 * twice for an already-completed purchase just returns the same result,
 * never double-credits.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Missing transaction reference." }, { status: 400 });

  const purchase = await withOrgScope(user.organizationId, (tx) =>
    tx.creditPurchase.findFirst({
      where: { txRef: parsed.data.txRef, organizationId: user.organizationId },
    })
  );
  if (!purchase) return NextResponse.json({ error: "Purchase not found." }, { status: 404 });

  if (purchase.status === "completed") {
    return NextResponse.json({ status: "completed", credits: purchase.credits });
  }

  let verification;
  try {
    verification = await verifyTransactionByRef(purchase.txRef);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Verification failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const expectedAmount = Number(purchase.amountUsd);
  const matches =
    verification.status === "successful" &&
    verification.currency === "USD" &&
    Math.abs(verification.amount - expectedAmount) < 0.01;

  if (!matches) {
    await withOrgScope(user.organizationId, (tx) =>
      tx.creditPurchase.update({ where: { id: purchase.id }, data: { status: "failed" } })
    );
    return NextResponse.json({ status: "failed" });
  }

  await withOrgScope(user.organizationId, async (tx) => {
    await tx.creditPurchase.update({
      where: { id: purchase.id },
      data: { status: "completed", completedAt: new Date() },
    });
    await tx.aiCreditWallet.update({
      where: { organizationId: user.organizationId },
      data: { balance: { increment: purchase.credits } },
    });
  });

  return NextResponse.json({ status: "completed", credits: purchase.credits });
}
