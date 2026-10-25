import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, isEncrypted, openSecret, sealSecret } from "../src/lib/secrets";

const saved = { ...process.env };
beforeEach(() => {
  process.env.SECRETS_KEY = "unit-test-secrets-key";
});
afterEach(() => {
  process.env = { ...saved };
});

describe("secrets at rest", () => {
  it("round-trips, and the stored form does not contain the plaintext", () => {
    const stored = encryptSecret("hunter2-smtp-password");
    expect(isEncrypted(stored)).toBe(true);
    expect(stored).not.toContain("hunter2");
    expect(decryptSecret(stored)).toBe("hunter2-smtp-password");
  });

  it("uses a fresh IV each time (equal secrets look different)", () => {
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });

  it("round-trips multi-line PEM keys and unicode", () => {
    const pem = "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkq\n-----END PRIVATE KEY-----\n";
    expect(decryptSecret(encryptSecret(pem))).toBe(pem);
    expect(decryptSecret(encryptSecret("pässwörd-密码"))).toBe("pässwörd-密码");
  });

  it("rejects a tampered value and the wrong key", () => {
    const stored = encryptSecret("secret");
    const flipped = stored.slice(0, -4) + (stored.endsWith("AAAA") ? "BBBB" : "AAAA");
    expect(() => decryptSecret(flipped)).toThrow(/Could not decrypt/);
    process.env.SECRETS_KEY = "a-different-key";
    expect(() => decryptSecret(stored)).toThrow(/Could not decrypt/);
  });

  it("treats un-prefixed legacy values as plaintext, and seal is idempotent", () => {
    expect(decryptSecret("legacy-plain")).toBe("legacy-plain");
    const once = sealSecret("abc")!;
    expect(sealSecret(once)).toBe(once);
    expect(sealSecret("")).toBeNull();
    expect(sealSecret(null)).toBeNull();
    expect(openSecret(null)).toBeUndefined();
    expect(openSecret(once)).toBe("abc");
  });

  it("falls back to SESSION_SECRET when SECRETS_KEY is absent", () => {
    delete process.env.SECRETS_KEY;
    process.env.SESSION_SECRET = "session-secret-material";
    const stored = encryptSecret("x");
    expect(decryptSecret(stored)).toBe("x");
  });
});
