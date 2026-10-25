import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth/session";

const PUBLIC_PATHS = ["/login", "/signup", "/privacy", "/data-deletion", "/bot"];
const PUBLIC_PREFIXES = ["/invite/", "/f/", "/u/", "/t/"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.includes(pathname) || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySessionToken(token) : null;

  // Neutron Brain's own-account access: a bearer token matching NEUTRON_BRAIN_API_KEY lets the
  // request through to the route handler, which resolves it to the owner's own account via
  // getCurrentUser() (src/lib/auth/current-user.ts) - this gate is just a prefilter, not the
  // final authority, so a plain comparison here is fine; the real timing-safe check lives there.
  const apiKey = process.env.NEUTRON_BRAIN_API_KEY;
  const authHeader = request.headers.get("authorization");
  const presentedKey = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : null;
  const viaApiKey = !!apiKey && !!presentedKey && presentedKey === apiKey;

  if (!session && !viaApiKey) {
    if (pathname.startsWith("/api")) {
      return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    }
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  // Everything except static assets, Next internals, the auth/invites API
  // routes (those enforce their own logic and would otherwise redirect-loop
  // against themselves, or need to work with no session at all), and
  // api/webhooks (Meta calls these with no session cookie at all -- its own
  // hub.verify_token handshake and payload signature are the real auth).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/auth|api/invites|api/webhooks|api/intake|api/inbound).*)"],
};
