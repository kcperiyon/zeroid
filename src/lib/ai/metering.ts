import { MODEL_PRICING } from "./router";
import { withBusinessScope } from "@/lib/tenant-db";
import type { AiResult } from "./types";

// Placeholder conversion rate (1 credit = $0.001 = 1,000 credits per USD) —
// see docs/build-spec.md §7/§9. This is a starting point for the metering
// mechanism, not a calibrated business rate; revisit once real usage data
// exists on what this account can actually charge per credit.
export const CREDITS_PER_USD = 1000;

export function creditsForResult(result: AiResult): number {
  const pricing = MODEL_PRICING[result.model];
  if (!pricing) return 0; // unknown model — don't fabricate a cost
  const usd =
    (result.tokensIn / 1000) * pricing.usdPerKIn + (result.tokensOut / 1000) * pricing.usdPerKOut;
  return Math.max(1, Math.ceil(usd * CREDITS_PER_USD));
}

/**
 * Runs an AI call and records it: AiUsageLog (business-scoped ledger entry)
 * and a debit against the organization's AiCreditWallet — see build-spec §7's
 * withMetering(). If the call throws, nothing is logged and nothing is
 * charged (see build-spec §7: "If the call fails ... don't charge credits").
 * A call is refused up front when the wallet is empty (added 2026-09-26,
 * before the app got a public URL: new organizations start at 0 credits, so
 * without this anyone signing up could spend the platform's own Anthropic
 * key). A call that starts with a positive balance may finish slightly
 * negative -- cost is only known after the model responds.
 */
export class InsufficientCreditsError extends Error {
  constructor() {
    super("You're out of AI credits. Buy more on the Billing page to keep using AI features.");
  }
}

export async function meterAiCall(
  organizationId: string,
  businessId: string,
  task: string,
  run: () => Promise<AiResult>
): Promise<AiResult> {
  const wallet = await withBusinessScope(organizationId, businessId, (tx) =>
    tx.aiCreditWallet.findUnique({ where: { organizationId } })
  );
  if (!wallet || wallet.balance <= 0) throw new InsufficientCreditsError();

  const result = await run();
  const credits = creditsForResult(result);

  await withBusinessScope(organizationId, businessId, async (tx) => {
    await tx.aiUsageLog.create({
      data: {
        businessId,
        task,
        model: result.model,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        creditsCharged: credits,
      },
    });
    await tx.aiCreditWallet.update({
      where: { organizationId },
      data: { balance: { decrement: credits } },
    });
  });

  return result;
}
