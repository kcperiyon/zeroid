import { NextResponse } from "next/server";
import { z } from "zod";
import { withBusinessScope } from "@/lib/tenant-db";
import { authorizeBusiness, CAMPAIGN_ROLES } from "@/lib/api-auth";
import { addSuppression, looksLikeEmail, normaliseEmail } from "@/lib/email-campaigns/suppression";
import { cancelPendingForEmail } from "@/lib/email-campaigns/unsubscribe";

/** This business own do-not-email list. Platform-wide entries are read-only here (they protect everyone). */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeBusiness(context, CAMPAIGN_ROLES);
  if ("error" in auth) return auth.error;
  const data = await withBusinessScope(auth.user.organizationId, auth.businessId, async (tx) => {
    const mine = await tx.suppression.findMany({ where: { businessId: auth.businessId }, orderBy: { createdAt: "desc" }, take: 500 });
    const globalCount = await tx.suppression.count({ where: { businessId: null } });
    return { mine, globalCount };
  });
  return NextResponse.json({ suppressions: data.mine, platformWideCount: data.globalCount });
}

const AddSchema = z.object({ emails: z.string().min(3).max(50_000) });

/** Paste emails (comma, space or newline separated) to stop emailing them. Pending emails are cancelled at once. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeBusiness(context, CAMPAIGN_ROLES);
  if ("error" in auth) return auth.error;
  const parsed = AddSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Paste at least one email address." }, { status: 400 });

  const all = [...new Set(parsed.data.emails.split(/[\s,;]+/).map(normaliseEmail).filter(Boolean))];
  const valid = all.filter(looksLikeEmail).slice(0, 2000);
  const result = await withBusinessScope(auth.user.organizationId, auth.businessId, async (tx) => {
    for (const email of valid) {
      await addSuppression(tx, { businessId: auth.businessId, email, reason: "manual", source: "manual_entry" });
      await cancelPendingForEmail(tx, auth.businessId, email);
    }
    return valid.length;
  });
  return NextResponse.json({ added: result, ignored: all.length - valid.length }, { status: 201 });
}

/** Removes a business-level entry (e.g. added by mistake). Hard bounces / complaints (platform-wide) cannot be removed here. */
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeBusiness(context, ["owner", "admin"]);
  if ("error" in auth) return auth.error;
  const email = normaliseEmail(new URL(request.url).searchParams.get("email") ?? "");
  if (!looksLikeEmail(email)) return NextResponse.json({ error: "Give the email address to remove." }, { status: 400 });
  const removed = await withBusinessScope(auth.user.organizationId, auth.businessId, (tx) =>
    tx.suppression.deleteMany({ where: { businessId: auth.businessId, email, reason: { in: ["manual", "unsubscribe"] } } })
  );
  if (!removed.count) return NextResponse.json({ error: "Not found on this business list (or it is a bounce/complaint, which cannot be removed)." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
