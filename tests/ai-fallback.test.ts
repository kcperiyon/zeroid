// The fallback must engage only for provider outages (out of credit, rate
// limit, overload, bad key, network) -- never for a request that is simply
// wrong -- must record and charge the model that actually answered, and must
// never be reachable when the customer's own Zeroid wallet is empty.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/lib/db";
import { withOrgScope, withBusinessScope } from "../src/lib/tenant-db";
import { PROVIDERS, FALLBACK_ROUTE } from "../src/lib/ai/router";
import { generate } from "../src/lib/ai";
import { isProviderOutage, resetFallbackState } from "../src/lib/ai/fallback";
import type { AiProvider } from "../src/lib/ai/types";

let org: { id: string };
let business: { id: string };
const realClaude = PROVIDERS.claude;
const realGemini = PROVIDERS.gemini;

const claudeOutOfCredit: AiProvider = {
  name: "claude",
  generate: async () => {
    throw Object.assign(new Error("Your credit balance is too low to access the Anthropic API."), { status: 400 });
  },
};

function fakeGemini(counter: { calls: number }): AiProvider & { isConfigured(): boolean } {
  return {
    name: "gemini",
    isConfigured: () => true,
    generate: async (_input, model) => {
      counter.calls++;
      return { text: "from gemini", model, tokensIn: 1000, tokensOut: 1000 };
    },
  };
}

beforeAll(async () => {
  org = await db.organization.create({ data: { name: "Fallback Test Org", slug: `ai-fallback-${Date.now()}` } });
  business = await withOrgScope(org.id, (tx) => tx.business.create({ data: { organizationId: org.id, name: "B" } }));
  await withOrgScope(org.id, (tx) => tx.aiCreditWallet.create({ data: { organizationId: org.id, balance: 100000 } }));
});

beforeEach(() => {
  PROVIDERS.claude = realClaude;
  PROVIDERS.gemini = realGemini;
  resetFallbackState();
});

afterAll(async () => {
  PROVIDERS.claude = realClaude;
  PROVIDERS.gemini = realGemini;
  await withBusinessScope(org.id, business.id, (tx) => tx.aiUsageLog.deleteMany({ where: { businessId: business.id } }));
  await withOrgScope(org.id, (tx) => tx.business.deleteMany({ where: { organizationId: org.id } }));
  await withOrgScope(org.id, (tx) => tx.aiCreditWallet.deleteMany({ where: { organizationId: org.id } }));
  await db.organization.delete({ where: { id: org.id } });
});

describe("isProviderOutage", () => {
  it("treats credit exhaustion, rate limits, overload, auth and network failures as outages", () => {
    expect(isProviderOutage({ status: 400, message: "Your credit balance is too low" })).toBe(true);
    expect(isProviderOutage({ status: 429, message: "rate limited" })).toBe(true);
    expect(isProviderOutage({ status: 529, message: "Overloaded" })).toBe(true);
    expect(isProviderOutage({ status: 401, message: "invalid x-api-key" })).toBe(true);
    expect(isProviderOutage(new Error("fetch failed"))).toBe(true);
    expect(isProviderOutage(new Error("ANTHROPIC_API_KEY is not set."))).toBe(true);
  });
  it("does not treat a bad request or an unrelated error as an outage", () => {
    expect(isProviderOutage({ status: 400, message: "messages: text content blocks must be non-empty" })).toBe(false);
    expect(isProviderOutage(new Error("simulated provider failure"))).toBe(false);
  });
});

describe("generate() with fallback", () => {
  it("answers from Gemini when Anthropic is out of credit, and records and charges the Gemini model", async () => {
    const counter = { calls: 0 };
    PROVIDERS.claude = claudeOutOfCredit;
    PROVIDERS.gemini = fakeGemini(counter);

    const result = await generate(org.id, business.id, "follow_up_draft", { system: "s", prompt: "p" });
    expect(result.text).toBe("from gemini");
    expect(counter.calls).toBe(1);

    const log = await withBusinessScope(org.id, business.id, (tx) =>
      tx.aiUsageLog.findFirst({ where: { businessId: business.id }, orderBy: { createdAt: "desc" } })
    );
    expect(log?.model).toBe(FALLBACK_ROUTE.model);
    expect(log?.creditsCharged).toBeGreaterThan(0);
  });

  it("skips the failing primary for a while after an outage (cooldown)", async () => {
    const counter = { calls: 0 };
    let claudeCalls = 0;
    PROVIDERS.claude = {
      name: "claude",
      generate: async () => {
        claudeCalls++;
        throw Object.assign(new Error("Overloaded"), { status: 529 });
      },
    };
    PROVIDERS.gemini = fakeGemini(counter);

    await generate(org.id, business.id, "follow_up_draft", { system: "s", prompt: "p" });
    await generate(org.id, business.id, "follow_up_draft", { system: "s", prompt: "p" });
    expect(claudeCalls).toBe(1);
    expect(counter.calls).toBe(2);
  });

  it("does not fall back for an ordinary request error", async () => {
    const counter = { calls: 0 };
    PROVIDERS.claude = {
      name: "claude",
      generate: async () => {
        throw Object.assign(new Error("messages: text content blocks must be non-empty"), { status: 400 });
      },
    };
    PROVIDERS.gemini = fakeGemini(counter);

    await expect(generate(org.id, business.id, "follow_up_draft", { system: "s", prompt: "p" })).rejects.toThrow(
      "non-empty"
    );
    expect(counter.calls).toBe(0);
  });

  it("rethrows the original error when no fallback is configured", async () => {
    PROVIDERS.claude = claudeOutOfCredit;
    PROVIDERS.gemini = { name: "gemini", isConfigured: () => false, generate: async () => { throw new Error("should not run"); } } as AiProvider;
    await expect(generate(org.id, business.id, "follow_up_draft", { system: "s", prompt: "p" })).rejects.toThrow(
      "credit balance"
    );
  });

  it("never calls either provider when the customer's wallet is empty", async () => {
    const counter = { calls: 0 };
    PROVIDERS.claude = claudeOutOfCredit;
    PROVIDERS.gemini = fakeGemini(counter);
    await withOrgScope(org.id, (tx) => tx.aiCreditWallet.update({ where: { organizationId: org.id }, data: { balance: 0 } }));

    await expect(generate(org.id, business.id, "follow_up_draft", { system: "s", prompt: "p" })).rejects.toThrow(
      "out of AI credits"
    );
    expect(counter.calls).toBe(0);
  });
});
