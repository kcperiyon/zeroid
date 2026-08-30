import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "zeroid_session";
const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 30; // 30 days

interface SessionPayload {
  userId: string;
  organizationId: string;
  [key: string]: unknown;
}

function secretKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET is not set. Add it to .env.local — see .env.example.");
  }
  return new TextEncoder().encode(secret);
}

export async function createSessionToken(payload: SessionPayload): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DURATION_SECONDS}s`)
    .sign(secretKey());
}

/** Returns null on any invalid/expired/tampered token rather than throwing — callers just treat it as logged out. */
export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (typeof payload.userId !== "string" || typeof payload.organizationId !== "string") return null;
    return payload as SessionPayload;
  } catch {
    return null;
  }
}

export const SESSION_COOKIE_MAX_AGE = SESSION_DURATION_SECONDS;
