import { recordClick } from "@/lib/email-campaigns/unsubscribe";
import { decodeUrl, isHttpUrl, verifyLink } from "@/lib/email-campaigns/template";

/**
 * Click tracking: /t/c/<token>?u=<base64url url>&s=<signature>. The signature binds the URL to the
 * message token, so this cannot be used as an open redirect to arbitrary sites.
 */
export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const { searchParams } = new URL(request.url);
  const encoded = searchParams.get("u") ?? "";
  const signature = searchParams.get("s") ?? "";

  let url = "";
  try {
    url = decodeUrl(encoded);
  } catch {
    return new Response("Bad link", { status: 400 });
  }
  if (!url || !isHttpUrl(url) || !verifyLink(token, url, signature)) {
    return new Response("Bad link", { status: 400 });
  }
  try {
    await recordClick(token, url);
  } catch {
    // never block the visitor on a tracking failure
  }
  return new Response(null, { status: 302, headers: { location: url, "cache-control": "no-store", "referrer-policy": "no-referrer" } });
}
