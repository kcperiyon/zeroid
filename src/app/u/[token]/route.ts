import { unsubscribeByToken } from "@/lib/email-campaigns/unsubscribe";
import { invalidLinkPage, unsubscribedPage } from "@/lib/email-campaigns/pages";

/**
 * Public unsubscribe endpoint (no session). GET unsubscribes IMMEDIATELY (the recipient clicked the
 * link in an email -- no extra confirmation step, and no failure mode that leaves them subscribed).
 * POST handles RFC 8058 one-click (mail clients send "List-Unsubscribe=One-Click") and the
 * "stop all Zeroid senders" button on the confirmation page.
 */
const HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "x-robots-tag": "noindex, nofollow",
  "referrer-policy": "no-referrer",
};

export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const result = await unsubscribeByToken(token, "business");
  if (!result.ok) return new Response(invalidLinkPage(), { status: 404, headers: HEADERS });
  return new Response(unsubscribedPage({ ...result, token }), { status: 200, headers: HEADERS });
}

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  let scope: "business" | "global" = "business";
  const body = await request.text().catch(() => "");
  if (/(^|&)scope=global(&|$)/.test(body)) scope = "global";

  const result = await unsubscribeByToken(token, scope);
  if (!result.ok) return new Response(invalidLinkPage(), { status: 404, headers: HEADERS });
  // One-click clients only need a 2xx; browsers submitting the form get the confirmation page.
  const wantsHtml = (request.headers.get("accept") ?? "").includes("text/html");
  return wantsHtml
    ? new Response(unsubscribedPage({ ...result, token }), { status: 200, headers: HEADERS })
    : new Response("OK", { status: 200, headers: { "cache-control": "no-store" } });
}
