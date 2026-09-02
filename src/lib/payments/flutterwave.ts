// Flutterwave payments — see docs/build-spec.md §9/§13. Plain REST calls,
// no SDK. This account's key is shared with Mongozutu and Flux9 (see the
// [[flutterwave-shared-account-rotation]] memory) — never rotate it from
// here without checking those two products too.
//
// Redirect-only, no webhook: Flutterwave's webhook slot for this account is
// already claimed by Mongozutu/Flux9's own webhook URLs, and a payment
// gateway account has one webhook config, not one per consumer. So this
// relies solely on verifying the transaction when the buyer's browser
// returns from the hosted checkout page. Known gap: if they close the tab
// before returning, there's currently no other way to learn the payment
// succeeded. Acceptable for now (pre-revenue, no real customers depending
// on this yet) — revisit if that ever stops being true.

interface CreatePaymentInput {
  txRef: string;
  amountUsd: number;
  customerEmail: string;
  redirectUrl: string;
  title: string;
}

interface CreatePaymentResult {
  checkoutUrl: string;
}

export async function createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
  const secretKey = process.env.FLUTTERWAVE_SECRET_KEY;
  if (!secretKey) {
    throw new Error("FLUTTERWAVE_SECRET_KEY is not set. Add it to .env.local — see .env.example.");
  }

  const response = await fetch("https://api.flutterwave.com/v3/payments", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      tx_ref: input.txRef,
      amount: input.amountUsd.toFixed(2),
      currency: "USD",
      redirect_url: input.redirectUrl,
      customer: { email: input.customerEmail },
      customizations: { title: input.title },
    }),
  });

  const body = await response.json();
  if (!response.ok || body.status !== "success") {
    throw new Error(`Flutterwave payment creation failed: ${JSON.stringify(body)}`);
  }
  return { checkoutUrl: body.data.link };
}

export interface VerifiedTransaction {
  status: "successful" | "failed" | "pending" | string;
  amount: number;
  currency: string;
  txRef: string;
}

/**
 * Verifies a transaction directly against Flutterwave by tx_ref — never
 * trust the redirect's own query params as proof of payment, they're
 * client-controlled. This is the only source of truth for "did this
 * actually get paid."
 */
export async function verifyTransactionByRef(txRef: string): Promise<VerifiedTransaction> {
  const secretKey = process.env.FLUTTERWAVE_SECRET_KEY;
  if (!secretKey) {
    throw new Error("FLUTTERWAVE_SECRET_KEY is not set.");
  }

  const response = await fetch(
    `https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${encodeURIComponent(txRef)}`,
    { headers: { Authorization: `Bearer ${secretKey}` } }
  );
  const body = await response.json();
  if (!response.ok || body.status !== "success") {
    throw new Error(`Flutterwave verification failed: ${JSON.stringify(body)}`);
  }

  return {
    status: body.data.status,
    amount: body.data.amount,
    currency: body.data.currency,
    txRef: body.data.tx_ref,
  };
}
