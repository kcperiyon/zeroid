import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/current-user";
import { withOrgScope } from "@/lib/tenant-db";
import { createPayment } from "@/lib/payments/flutterwave";
import { CREDITS_PER_USD } from "@/lib/ai/metering";

const RequestSchema = z.object({ amountUsd: z.number().min(1).max(1000) });

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  if (!["owner", "admin"].includes(user.role)) {
    return NextResponse.json({ error: "Only owners and admins can purchase credits." }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter an amount between $1 and $1000." }, { status: 400 });
  }

  const txRef = `zeroid-credits-${user.organizationId}-${Date.now()}`;
  const credits = Math.round(parsed.data.amountUsd * CREDITS_PER_USD);

  await withOrgScope(user.organizationId, (tx) =>
    tx.creditPurchase.create({
      data: {
        organizationId: user.organizationId,
        txRef,
        amountUsd: parsed.data.amountUsd,
        credits,
        status: "pending",
      },
    })
  );

  const origin = new URL(request.url).origin;
  let checkoutUrl: string;
  try {
    const result = await createPayment({
      txRef,
      amountUsd: parsed.data.amountUsd,
      customerEmail: user.email,
      redirectUrl: `${origin}/billing/return`,
      title: `Zeroid AI credits — ${credits.toLocaleString()} credits`,
    });
    checkoutUrl = result.checkoutUrl;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Payment creation failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  return NextResponse.json({ checkoutUrl });
}
