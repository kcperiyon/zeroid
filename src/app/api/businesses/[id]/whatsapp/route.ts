import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getBusinessInOrg, withBusinessScope } from "@/lib/tenant-db";

const ConnectSchema = z.object({
  phoneNumberId: z.string().trim().min(1).max(60),
  wabaId: z.string().trim().min(1).max(60),
  displayPhoneNumber: z.string().trim().max(30).optional(),
  accessToken: z.string().trim().min(20).max(4000),
});

const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION ?? "v21.0";

/**
 * Confirms the token really works for this phone number before it is saved --
 * a token pasted together with another field, truncated, or from the wrong app
 * would otherwise be stored and then fail silently on every message. Meta's
 * error text can echo the token back, so it is redacted before it is returned.
 */
async function checkTokenWithMeta(phoneNumberId: string, accessToken: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(phoneNumberId)}?fields=display_phone_number,verified_name`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    if (res.ok && !body?.error) return null;
    const raw = body?.error?.message ?? `Meta returned status ${res.status}.`;
    return raw.split(accessToken).join("[token]").replace(/EAA[A-Za-z0-9]{20,}/g, "[token]");
  } catch {
    return "Could not reach Meta to check the token. Try again.";
  }
}

function maskToken(token: string) {
  return `••••${token.slice(-4)}`;
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id: businessId } = await context.params;
  const business = await getBusinessInOrg(user.organizationId, businessId);
  if (!business) return NextResponse.json({ error: "Business not found." }, { status: 404 });

  const connection = await withBusinessScope(user.organizationId, businessId, (tx) =>
    tx.whatsAppConnection.findFirst({ where: { businessId } })
  );

  if (!connection) return NextResponse.json({ connection: null });
  return NextResponse.json({
    connection: {
      phoneNumberId: connection.phoneNumberId,
      wabaId: connection.wabaId,
      displayPhoneNumber: connection.displayPhoneNumber,
      accessTokenMasked: maskToken(connection.accessToken),
      createdAt: connection.createdAt,
    },
  });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  if (!["owner", "admin"].includes(user.role)) {
    return NextResponse.json({ error: "Only an owner or admin can connect WhatsApp." }, { status: 403 });
  }

  const { id: businessId } = await context.params;
  const business = await getBusinessInOrg(user.organizationId, businessId);
  if (!business) return NextResponse.json({ error: "Business not found." }, { status: 404 });

  const body = await request.json().catch(() => null);
  const parsed = ConnectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid connection details." }, { status: 400 });
  }

  const tokenProblem = await checkTokenWithMeta(parsed.data.phoneNumberId, parsed.data.accessToken);
  if (tokenProblem) {
    return NextResponse.json(
      {
        error:
          `Meta rejected that Phone number ID / token: ${tokenProblem} ` +
          "Paste only the token (it starts with EAA) in the Access token box, and only the number ID in the Phone number ID box.",
      },
      { status: 400 }
    );
  }

  try {
    await withBusinessScope(user.organizationId, businessId, (tx) =>
      tx.whatsAppConnection.upsert({
        where: { businessId },
        update: {
          phoneNumberId: parsed.data.phoneNumberId,
          wabaId: parsed.data.wabaId,
          displayPhoneNumber: parsed.data.displayPhoneNumber,
          accessToken: parsed.data.accessToken,
        },
        create: {
          businessId,
          organizationId: user.organizationId,
          phoneNumberId: parsed.data.phoneNumberId,
          wabaId: parsed.data.wabaId,
          displayPhoneNumber: parsed.data.displayPhoneNumber,
          accessToken: parsed.data.accessToken,
        },
      })
    );
  } catch (error) {
    // Most likely the phoneNumberId is already connected to a different business (unique constraint).
    const message = error instanceof Error && error.message.includes("Unique constraint")
      ? "That phone number ID is already connected to another business."
      : "Could not save the connection.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  if (!["owner", "admin"].includes(user.role)) {
    return NextResponse.json({ error: "Only an owner or admin can disconnect WhatsApp." }, { status: 403 });
  }

  const { id: businessId } = await context.params;
  const business = await getBusinessInOrg(user.organizationId, businessId);
  if (!business) return NextResponse.json({ error: "Business not found." }, { status: 404 });

  await withBusinessScope(user.organizationId, businessId, (tx) =>
    tx.whatsAppConnection.deleteMany({ where: { businessId } })
  );

  return NextResponse.json({ ok: true });
}
