import { MODEL_PRICING } from "./router";
import { withBusinessScope } from "@/lib/tenant-db";
import type { AiResult } from "./types";

// Placeholder conversion rate (1 credit = $0.001 = 1,000 credits per USD) —
// see docs/build-spec.md §7/§9. This is a starting point for the metering
// mechanism, not a calibrated business rate; revisit once real usage data
// exists on what this account can actually charge per credit.
const CREDITS_PER_USD = 1000;

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
 * Enforcement (blocking calls once a wallet is depleted) is intentionally
 * not built yet — Phase 1 has no real billing to enforce against; this is
 * the ledger that later billing work will read.
 */
export async function meterAiCall(
  organizationId: string,
  businessId: string,
  task: string,
  run: () => Promise<AiResult>
): Promise<AiResult> {
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
