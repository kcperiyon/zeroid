import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { handleInboundEmail } from "@/lib/email-campaigns/inbound";

/**
 * Receives raw inbound mail (RFC 822) from our own MTA -- e.g. a Postfix pipe that POSTs each
 * message here -- or any relay that forwards raw messages. Bounces, complaints and replies are
 * matched back to the campaign email they answer. Authenticated with a shared secret.
 */
const MAX_BYTES = 2 * 1024 * 1024;

function secretOk(provided: string | null): boolean {
  const expected = process.env.INBOUND_EMAIL_SECRET;
  if (!expected || !provided) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (!process.env.INBOUND_EMAIL_SECRET) {
    return NextResponse.json({ error: "Inbound mail is not configured." }, { status: 503 });
  }
  if (!secretOk(request.headers.get("x-inbound-secret"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const raw = Buffer.from(await request.arrayBuffer());
  if (raw.length === 0 || raw.length > MAX_BYTES) {
    return NextResponse.json({ error: "Message missing or too large." }, { status: 413 });
  }
  try {
    const result = await handleInboundEmail(raw);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    console.error("Inbound email failed:", error);
    // Acknowledge so the MTA does not retry forever on a message we cannot parse.
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
