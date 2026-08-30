import type { Prisma } from "@/generated/prisma/client";

type Tx = Prisma.TransactionClient;

/** Every meaningful lead change gets an event — this is the unified timeline from build-spec §22/§35. */
export function recordLeadEvent(
  tx: Tx,
  args: { businessId: string; leadId: string; type: string; payload?: Record<string, unknown> }
) {
  return tx.leadEvent.create({
    data: {
      businessId: args.businessId,
      leadId: args.leadId,
      type: args.type,
      payload: args.payload ?? {},
    },
  });
}
