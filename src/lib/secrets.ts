import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

/**
 * Encryption at rest for credentials we must store to use later (SMTP / IMAP passwords, DKIM
 * private keys). AES-256-GCM with a random IV per value, so equal secrets never look alike and
 * any tampering fails authentication.
 *
 * Key: SECRETS_KEY if set (recommended, and keep it out of version control and backups of the
 * database), otherwise derived from SESSION_SECRET. Whichever is used must stay the same, or
 * previously stored values cannot be read.
 *
 * Stored form: "enc:v1:" + base64(iv(12) | authTag(16) | ciphertext). Values without the prefix
 * are treated as legacy plaintext and returned as-is, so existing rows keep working until they
 * are re-saved (the worker upgrades them at start-up).
 */
const PREFIX = "enc:v1:";
let cachedKey: Buffer | null = null;
let cachedFrom = "";

function key(): Buffer {
  const material = process.env.SECRETS_KEY ?? process.env.SESSION_SECRET;
  if (!material) throw new Error("SECRETS_KEY (or SESSION_SECRET) must be set to store credentials.");
  if (!cachedKey || cachedFrom !== material) {
    cachedKey = scryptSync(material, "zeroid-secrets-v1", 32);
    cachedFrom = material;
  }
  return cachedKey;
}

export const isEncrypted = (value: string | null | undefined): boolean => Boolean(value?.startsWith(PREFIX));

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
}

/** Decrypts a stored value; legacy plaintext (no prefix) passes through unchanged. */
export function decryptSecret(stored: string): string {
  if (!stored.startsWith(PREFIX)) return stored;
  const raw = Buffer.from(stored.slice(PREFIX.length), "base64");
  if (raw.length < 29) throw new Error("Stored secret is corrupt.");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("Could not decrypt a stored secret (wrong SECRETS_KEY / SESSION_SECRET, or the value was altered).");
  }
}

/** Encrypts unless already encrypted; empty input stays empty (null). */
export function sealSecret(value: string | null | undefined): string | null {
  if (!value) return null;
  return isEncrypted(value) ? value : encryptSecret(value);
}

export function openSecret(stored: string | null | undefined): string | undefined {
  return stored ? decryptSecret(stored) : undefined;
}
