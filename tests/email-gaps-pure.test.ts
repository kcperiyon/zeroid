import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { inferTimezone } from "../src/lib/email-campaigns/timezone-infer";
import { checkDomainHealth, evaluateDkim, evaluateDmarc, evaluateSpf, publicKeyFromPrivatePem, type Resolver } from "../src/lib/email-campaigns/domain-health";
import { pickVariant } from "../src/lib/email-campaigns/engine";

describe("timezone inference", () => {
  it("trusts an explicit valid timezone on the lead first", () => {
    expect(inferTimezone({ contact: { timezone: "Asia/Tokyo", country: "Nigeria" }, phone: "+2348012345678" })).toBe("Asia/Tokyo");
  });
  it("ignores an invalid explicit timezone and falls through", () => {
    expect(inferTimezone({ contact: { timezone: "Mars/Olympus", country: "Germany" } })).toBe("Europe/Berlin");
  });
  it("uses the country (name, alias or ISO code)", () => {
    expect(inferTimezone({ contact: { country: "Nigeria" } })).toBe("Africa/Lagos");
    expect(inferTimezone({ contact: { country: "UK" } })).toBe("Europe/London");
    expect(inferTimezone({ contact: { country: "gb" } })).toBe("Europe/London");
    expect(inferTimezone({ contact: { country: "United States" } })).toBe("America/New_York");
  });
  it("uses the international phone dial code, longest prefix first", () => {
    expect(inferTimezone({ phone: "+234 801 234 5678" })).toBe("Africa/Lagos");
    expect(inferTimezone({ phone: "+971501234567" })).toBe("Asia/Dubai");
    expect(inferTimezone({ phone: "00447911123456" })).toBe("Europe/London");
    expect(inferTimezone({ phone: "+27821234567" })).toBe("Africa/Johannesburg");
  });
  it("does not guess from a local number without an international prefix", () => {
    expect(inferTimezone({ phone: "08012345678" })).toBeNull();
  });
  it("falls back to the email country-code TLD, and returns null for .com", () => {
    expect(inferTimezone({ email: "buyer@acme.co.uk" })).toBe("Europe/London");
    expect(inferTimezone({ email: "buyer@firma.de" })).toBe("Europe/Berlin");
    expect(inferTimezone({ email: "buyer@acme.com" })).toBeNull();
    expect(inferTimezone({})).toBeNull();
  });
  it("prefers country over phone over email", () => {
    expect(inferTimezone({ contact: { country: "India" }, phone: "+2348012345678", email: "x@y.de" })).toBe("Asia/Kolkata");
    expect(inferTimezone({ phone: "+2348012345678", email: "x@y.de" })).toBe("Africa/Lagos");
  });
});

describe("domain health: SPF", () => {
  it("fails with no record, with two records, and with +all", () => {
    expect(evaluateSpf([]).status).toBe("fail");
    expect(evaluateSpf(["v=spf1 mx ~all", "v=spf1 a -all"]).status).toBe("fail");
    expect(evaluateSpf(["v=spf1 +all"]).status).toBe("fail");
  });
  it("passes with a restrictive ending, warns without one, and warns when the relay is not included", () => {
    expect(evaluateSpf(["v=spf1 include:spf.brevo.com ~all"]).status).toBe("pass");
    expect(evaluateSpf(["v=spf1 mx"]).status).toBe("warn");
    expect(evaluateSpf(["v=spf1 mx ~all"], "brevo").status).toBe("warn");
    expect(evaluateSpf(["v=spf1 include:spf.brevo.com ~all"], "brevo").status).toBe("pass");
  });
});

describe("domain health: DKIM and DMARC", () => {
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const privatePem = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const publicB64 = pair.publicKey.export({ type: "spki", format: "der" }).toString("base64");
  const other = generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey.export({ type: "spki", format: "der" }).toString("base64");

  it("derives the DNS-form public key from the private key", () => {
    expect(publicKeyFromPrivatePem(privatePem)).toBe(publicB64);
    expect(publicKeyFromPrivatePem("not a key")).toBeNull();
  });
  it("passes only when the published key matches the signing key", () => {
    expect(evaluateDkim([`v=DKIM1; k=rsa; p=${publicB64}`], privatePem).status).toBe("pass");
    expect(evaluateDkim([`v=DKIM1; k=rsa; p=${other}`], privatePem).status).toBe("fail");
    expect(evaluateDkim([`v=DKIM1; p=`], privatePem).status).toBe("fail");
    expect(evaluateDkim([], privatePem).status).toBe("fail");
    expect(evaluateDkim([`v=DKIM1; k=rsa; p=${publicB64}`], null).status).toBe("warn");
  });
  it("copes with a DKIM key split across whitespace", () => {
    const split = publicB64.replace(/(.{60})/g, "$1 ");
    expect(evaluateDkim([`v=DKIM1; p=${split}`], privatePem).status).toBe("pass");
  });
  it("grades DMARC policy", () => {
    expect(evaluateDmarc([]).status).toBe("fail");
    expect(evaluateDmarc(["v=DMARC1; p=none"]).status).toBe("warn");
    expect(evaluateDmarc(["v=DMARC1; p=quarantine; rua=mailto:a@b.co"]).status).toBe("pass");
    expect(evaluateDmarc(["v=DMARC1; p=reject"]).status).toBe("pass");
    expect(evaluateDmarc(["v=DMARC1; foo=bar"]).status).toBe("warn");
  });

  it("checkDomainHealth combines all four checks using an injected resolver", async () => {
    const zone: Record<string, string[][]> = {
      "send.example": [["v=spf1 include:spf.brevo.com ~all"]],
      "z1._domainkey.send.example": [[`v=DKIM1; k=rsa; p=${publicB64.slice(0, 100)}`, publicB64.slice(100)]],
      "_dmarc.send.example": [["v=DMARC1; p=quarantine"]],
    };
    const resolver: Resolver = {
      resolveTxt: async (n) => {
        if (n in zone) return zone[n];
        throw Object.assign(new Error("nx"), { code: "ENOTFOUND" });
      },
      resolveMx: async () => [{ exchange: "mx.send.example" }],
    };
    const checks = await checkDomainHealth("send.example", { selector: "z1", privateKeyPem: privatePem, spfInclude: "brevo", resolver });
    expect(checks.map((c) => `${c.name}:${c.status}`)).toEqual(["SPF:pass", "DKIM:pass", "DMARC:pass", "MX:pass"]);
  });

  it("a resolver outage reads as 'unknown' (warn), never as a false 'missing'", async () => {
    const broken: Resolver = {
      resolveTxt: async () => {
        throw Object.assign(new Error("timeout"), { code: "ETIMEOUT" });
      },
      resolveMx: async () => {
        throw Object.assign(new Error("timeout"), { code: "ETIMEOUT" });
      },
    };
    const checks = await checkDomainHealth("send.example", { selector: "z1", resolver: broken });
    expect(checks.every((c) => c.status === "warn")).toBe(true);
  });

  it("missing records are reported as failures", async () => {
    const empty: Resolver = {
      resolveTxt: async () => {
        throw Object.assign(new Error("nx"), { code: "ENODATA" });
      },
      resolveMx: async () => [],
    };
    const checks = await checkDomainHealth("nothing.example", { selector: "z1", resolver: empty });
    expect(checks.map((c) => c.status)).toEqual(["fail", "fail", "fail", "fail"]);
  });
});

describe("A/B variant assignment", () => {
  it("returns no variant when the step has no B subject", () => {
    expect(pickVariant("lead1", "step1", false)).toBeNull();
  });
  it("is stable for the same lead and step", () => {
    expect(pickVariant("lead1", "step1", true)).toBe(pickVariant("lead1", "step1", true));
  });
  it("splits roughly 50/50 across many leads", () => {
    let a = 0;
    for (let i = 0; i < 2000; i++) if (pickVariant(`lead-${i}`, "stepX", true) === "A") a++;
    expect(a).toBeGreaterThan(850);
    expect(a).toBeLessThan(1150);
  });
});
