import { recordOpen } from "@/lib/email-campaigns/unsubscribe";

// 1x1 transparent GIF.
const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

/** Open-tracking pixel: /t/o/<token>.gif. Always returns the image, even for a bad token. */
export async function GET(request: Request, context: { params: Promise<{ file: string }> }) {
  const { file } = await context.params;
  const token = file.replace(/\.gif$/i, "");
  try {
    await recordOpen(token, { userAgent: request.headers.get("user-agent") ?? undefined });
  } catch {
    // tracking must never break the image
  }
  return new Response(PIXEL, {
    status: 200,
    headers: { "content-type": "image/gif", "cache-control": "no-store, max-age=0", "content-length": String(PIXEL.length) },
  });
}
