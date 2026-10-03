import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getBusinessInOrg, withBusinessScope } from "@/lib/tenant-db";
import { subscribePage, verifyPage } from "@/lib/meta/graph";

const ConnectSchema = z.object({
  pageId: z.string().trim().min(1).max(60),
  pageAccessToken: z.string().trim().min(20).max(4000),
});

async function authorize(context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return { error: NextResponse.json({ error: "Not signed in." }, { status: 401 }) };
  if (!["owner", "admin"].includes(user.role)) {
    return { error: NextResponse.json({ error: "Only an owner or admin can manage Facebook & Instagram." }, { status: 403 }) };
  }
  const { id: businessId } = await context.params;
  const business = await getBusinessInOrg(user.organizationId, businessId);
  if (!business) return { error: NextResponse.json({ error: "Business not found." }, { status: 404 }) };
  return { user, businessId };
}

/**
 * Connects a Facebook Page (and the Instagram professional account linked to
 * it). The token is checked against Meta first -- an unverified token is never
 * stored -- and the webhook subscription result is reported honestly, since
 * Meta refuses it until the app has the right permissions.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorize(context);
  if ("error" in auth) return auth.error;
  const { user, businessId } = auth;

  const parsed = ConnectSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid connection details." }, { status: 400 });
  }
  const { pageId, pageAccessToken } = parsed.data;

  let page;
  try {
    page = await verifyPage(pageId, pageAccessToken);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not reach Meta.";
    return NextResponse.json({ error: `Meta rejected that Page ID / token: ${message}` }, { status: 400 });
  }

  let subscribed = false;
  let subscribeError: string | null = null;
  try {
    await subscribePage(pageId, pageAccessToken);
    subscribed = true;
  } catch (error) {
    subscribeError = error instanceof Error ? error.message : "Subscription failed.";
  }

  try {
    await withBusinessScope(user.organizationId, businessId, (tx) =>
      tx.metaConnection.upsert({
        where: { businessId },
        update: {
          pageId,
          pageName: page.name,
          instagramAccountId: page.instagramAccountId,
          pageAccessToken,
          subscribed,
        },
        create: {
          businessId,
          organizationId: user.organizationId,
          pageId,
          pageName: page.name,
          instagramAccountId: page.instagramAccountId,
          pageAccessToken,
          subscribed,
        },
      })
    );
  } catch (error) {
    const message =
      error instanceof Error && error.message.includes("Unique constraint")
        ? "That Page or Instagram account is already connected to another business."
        : "Could not save the connection.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  return NextResponse.json(
    { ok: true, pageName: page.name, instagramUsername: page.instagramUsername, subscribed, subscribeError },
    { status: 201 }
  );
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorize(context);
  if ("error" in auth) return auth.error;
  const { user, businessId } = auth;

  await withBusinessScope(user.organizationId, businessId, (tx) =>
    tx.metaConnection.deleteMany({ where: { businessId } })
  );
  return NextResponse.json({ ok: true });
}
