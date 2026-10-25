// Proves the sending safeguard: real prospects can never be emailed through the shared Brevo
// account (or any sandboxed identity), and "live" needs three independent things to be true.
import { describe, expect, it } from "vitest";
import { assertSendAllowed, checkSendAllowed, parseAllowList, SandboxBlockedError } from "../src/lib/email-campaigns/guard";

const OWNER = "owner@example.com";
const env = (over: Record<string, string | undefined> = {}) => ({
  CAMPAIGN_SANDBOX_ALLOWLIST: `${OWNER}, test-inbox@example.org`,
  ...over,
});

describe("allow-list parsing", () => {
  it("keeps only full addresses, lower-cased; ignores domains and wildcards", () => {
    const set = parseAllowList("A@X.com, @evil.com, *@evil.com, evil.com, b@y.org ; c@z.io");
    expect([...set].sort()).toEqual(["a@x.com", "b@y.org", "c@z.io"]);
  });
  it("an empty or missing list allows nothing", () => {
    expect(parseAllowList("").size).toBe(0);
    expect(parseAllowList(undefined).size).toBe(parseAllowList(process.env.CAMPAIGN_SANDBOX_ALLOWLIST).size);
  });
});

describe("shared Brevo account (brevo_shared) is always sandboxed", () => {
  const shared = { provider: "brevo_shared" as const, sandboxOnly: false };

  it("blocks a real prospect address", () => {
    const d = checkSendAllowed(shared, "ceo@real-prospect.com", env());
    expect(d.allowed).toBe(false);
  });

  it("blocks a real prospect even with live sending switched on and sandboxOnly=false", () => {
    const d = checkSendAllowed(shared, "ceo@real-prospect.com", env({ CAMPAIGN_ALLOW_LIVE_SENDING: "true" }));
    expect(d.allowed).toBe(false);
  });

  it("blocks a look-alike of an allow-listed address (domain/subdomain tricks)", () => {
    for (const sneaky of ["owner@example.com.evil.com", "xowner@example.com", "owner@example.co", "owner+x@example.com", "OWNER@example.com.au"]) {
      expect(checkSendAllowed(shared, sneaky, env()).allowed, sneaky).toBe(false);
    }
  });

  it("allows exactly the allow-listed addresses (case-insensitive) in sandbox mode", () => {
    expect(checkSendAllowed(shared, "OWNER@Example.com", env())).toEqual({ allowed: true, mode: "sandbox" });
    expect(checkSendAllowed(shared, "test-inbox@example.org", env())).toEqual({ allowed: true, mode: "sandbox" });
  });

  it("sends nothing at all when the allow-list is empty", () => {
    expect(checkSendAllowed(shared, OWNER, env({ CAMPAIGN_SANDBOX_ALLOWLIST: "" })).allowed).toBe(false);
  });
});

describe("own SMTP identity", () => {
  it("is sandboxed by default (sandboxOnly = true)", () => {
    expect(checkSendAllowed({ provider: "smtp", sandboxOnly: true }, "ceo@real-prospect.com", env({ CAMPAIGN_ALLOW_LIVE_SENDING: "true" })).allowed).toBe(false);
  });

  it("is still sandboxed when sandboxOnly=false but the server has not enabled live sending", () => {
    expect(checkSendAllowed({ provider: "smtp", sandboxOnly: false }, "ceo@real-prospect.com", env()).allowed).toBe(false);
    expect(checkSendAllowed({ provider: "smtp", sandboxOnly: false }, "ceo@real-prospect.com", env({ CAMPAIGN_ALLOW_LIVE_SENDING: "yes" })).allowed).toBe(false);
  });

  it("goes live only when the identity AND the server both allow it", () => {
    expect(checkSendAllowed({ provider: "smtp", sandboxOnly: false }, "ceo@real-prospect.com", env({ CAMPAIGN_ALLOW_LIVE_SENDING: "true" }))).toEqual({
      allowed: true,
      mode: "live",
    });
  });
});

describe("assertSendAllowed", () => {
  it("throws SandboxBlockedError for a real prospect via the shared account", () => {
    const saved = { ...process.env };
    process.env.CAMPAIGN_SANDBOX_ALLOWLIST = OWNER;
    delete process.env.CAMPAIGN_ALLOW_LIVE_SENDING;
    try {
      expect(() => assertSendAllowed({ provider: "brevo_shared", sandboxOnly: false }, "ceo@real-prospect.com")).toThrow(SandboxBlockedError);
      expect(assertSendAllowed({ provider: "brevo_shared", sandboxOnly: true }, OWNER)).toBe("sandbox");
    } finally {
      process.env = saved;
    }
  });
});
