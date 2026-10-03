import { NextResponse } from "next/server";
import { z } from "zod";
import { withBusinessScope, withIntakeKeyScope } from "@/lib/tenant-db";
import { ingestLead } from "@/lib/lead-intake";

/**
 * Public lead-capture endpoint. The key in the URL is write-only (it can
 * create leads, nothing else), so it is safe to put in a web page or an ad
 * platform's webhook setting -- the same trust model as a form ID. Because
 * it is public, it is defended in depth: size limits, a honeypot field, a
 * per-key and per-IP rate limit, and a requirement for a way to reach the person.
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const CHANNELS = ["api", "webhook", "facebook", "instagram", "google", "tiktok", "linkedin", "email"] as const;
const PAID_UTM_MEDIUMS = new Set(["cpc", "ppc", "paid", "paidsocial", "paid_social", "paid-social", "display", "ad", "ads"]);

const text = (max: number) => z.string().trim().max(max).optional();
const IntakeSchema = z.object({
  name: text(200),
  email: z.string().trim().email().max(200).optional().or(z.literal("").transform(() => undefined)),
  phone: text(40),
  company: text(200),
  message: text(2000),
  channel: z.enum(CHANNELS).optional(),
  medium: z.enum(["organic", "paid"]).optional(),
  campaign: text(200),
  utm_medium: text(60),
  utm_campaign: text(200),
  // Honeypot: real people never see this field, bots fill every input.
  website_url: text(500),
});

// In-memory sliding window. Fine for the single PM2 process this runs in; if
// Zeroid is ever scaled to several processes, move this to the database or Redis.
const hits = new Map<string, number[]>();
function rateLimited(bucket: string, limit: number, windowMs = 60_000): boolean {
  const now = Date.now();
  const recent = (hits.get(bucket) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    hits.set(bucket, recent);
    return true;
  }
  recent.push(now);
  hits.set(bucket, recent);
  if (hits.size > 5000) hits.clear();
  return false;
}

const json = (body: unknown, status: number) => NextResponse.json(body, { status, headers: CORS });

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(request: Request, context: { params: Promise<{ key: string }> }) {
  const { key } = await context.params;
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (rateLimited(`key:${key}`, 60) || rateLimited(`ip:${ip}`, 12)) {
    return json({ error: "Too many submissions. Try again in a minute." }, 429);
  }

  let raw: Record<string, unknown> = {};
  const contentType = request.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("application/json")) {
      raw = (await request.json()) as Record<string, unknown>;
    } else {
      raw = Object.fromEntries((await request.formData()).entries());
    }
  } catch {
    return json({ error: "Send JSON or form data." }, 400);
  }

  const parsed = IntakeSchema.safeParse(raw);
  if (!parsed.success) {
    return json({ error: parsed.error.issues[0]?.message ?? "Invalid submission." }, 400);
  }
  const d = parsed.data;

  // Honeypot tripped: pretend success so the bot learns nothing.
  if (d.website_url) return json({ ok: true }, 201);

  if (!d.email && !d.phone) {
    return json({ error: "Provide an email address or phone number so the business can reach you." }, 400);
  }

  const owner = await withIntakeKeyScope(key, (tx) => tx.intakeKey.findFirst({ where: { publicKey: key } }));
  if (!owner) return json({ error: "Unknown form." }, 404);

  const medium =
    d.medium ?? (d.utm_medium && PAID_UTM_MEDIUMS.has(d.utm_medium.toLowerCase()) ? "paid" : "organic");

  await withBusinessScope(owner.organizationId, owner.businessId, (tx) =>
    ingestLead(tx, owner.businessId, {
      channel: d.channel ?? "webhook",
      medium,
      campaign: d.campaign ?? d.utm_campaign,
      name: d.name,
      email: d.email,
      phone: d.phone,
      company: d.company,
      message: d.message,
      eventType: "form_submission",
    })
  );

  return json({ ok: true }, 201);
}
