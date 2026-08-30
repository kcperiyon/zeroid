// Verifies the AI abstraction layer's metering contract from build-spec §7:
// every call records actual token usage and debits the org's credit wallet;
// a failed call charges nothing. Uses a fake provider (no real Anthropic
// call, no ANTHROPIC_API_KEY needed) — this is exactly the "test the
// plumbing without spending real tokens" approach from build-spec §14.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/lib/db";
import { withOrgScope, withBusinessScope } from "../src/lib/tenant-db";
import { PROVIDERS } from "../src/lib/ai/router";
import { generate } from "../src/lib/ai";
import type { AiProvider } from "../src/lib/ai/types";

let org: { id: string };
let business: { id: string };
const realClaudeProvider = PROVIDERS.claude;

beforeAll(async () => {
  org = await db.organization.create({ data: { name: "AI Metering Test Org", slug: `ai-meter-${Date.now()}` } });
  business = await withOrgScope(org.id, (tx) => tx.business.create({ data: { organizationId: org.id, name: "Test Business" } }));
  await withOrgScope(org.id, (tx) => tx.aiCreditWallet.create({ data: { organizationId: org.id, balance: 1000 } }));
});

beforeEach(() => {
  PROVIDERS.claude = realClaudeProvider;
});

afterAll(async () => {
  await withBusinessScope(org.id, business.id, (tx) => tx.aiUsageLog.deleteMany({ where: { businessId: business.id } }));
  await withOrgScope(org.id, (tx) => tx.business.deleteMany({ where: { organizationId: org.id } }));
  await withOrgScope(org.id, (tx) => tx.aiCreditWallet.deleteMany({ where: { organizationId: org.id } }));
  await db.organization.delete({ where: { id: org.id } });
  PROVIDERS.claude = realClaudeProvider;
});

describe("AI metering", () => {
  it("records usage and debits the wallet on a successful call", async () => {
    const fake: AiProvider = {
      name: "claude",
      generate: async () => ({ text: "hi", model: "claude-sonnet-5", tokensIn: 1000, tokensOut: 1000 }),
    };
    PROVIDERS.claude = fake;

    const before = await withOrgScope(org.id, (tx) => tx.aiCreditWallet.findUnique({ where: { organizationId: org.id } }));

    const result = await generate(org.id, business.id, "follow_up_draft", {
      system: "test",
      prompt: "test",
    });
    expect(result.text).toBe("hi");

    const log = await withBusinessScope(org.id, business.id, (tx) =>
      tx.aiUsageLog.findFirst({ where: { businessId: business.id }, orderBy: { createdAt: "desc" } })
    );
    expect(log?.tokensIn).toBe(1000);
    expect(log?.tokensOut).toBe(1000);
    expect(log?.creditsCharged).toBeGreaterThan(0);

    const after = await withOrgScope(org.id, (tx) => tx.aiCreditWallet.findUnique({ where: { organizationId: org.id } }));
    expect(after!.balance).toBe(before!.balance - log!.creditsCharged);
  });

  it("charges nothing and logs nothing when the provider call fails", async () => {
    const failing: AiProvider = {
      name: "claude",
      generate: async () => {
        throw new Error("simulated provider failure");
      },
    };
    PROVIDERS.claude = failing;

    const before = await withOrgScope(org.id, (tx) => tx.aiCreditWallet.findUnique({ where: { organizationId: org.id } }));
    const countBefore = await withBusinessScope(org.id, business.id, (tx) => tx.aiUsageLog.count({ where: { businessId: business.id } }));

    await expect(
      generate(org.id, business.id, "follow_up_draft", { system: "test", prompt: "test" })
    ).rejects.toThrow("simulated provider failure");

    const after = await withOrgScope(org.id, (tx) => tx.aiCreditWallet.findUnique({ where: { organizationId: org.id } }));
    const countAfter = await withBusinessScope(org.id, business.id, (tx) => tx.aiUsageLog.count({ where: { businessId: business.id } }));

    expect(after!.balance).toBe(before!.balance);
    expect(countAfter).toBe(countBefore);
  });
});
