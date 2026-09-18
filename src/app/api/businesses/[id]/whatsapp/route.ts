import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getBusinessInOrg, withBusinessScope } from "@/lib/tenant-db";

const ConnectSchema = z.object({
  phoneNumberId: z.string().min(1).max(60),
  wabaId: z.string().min(1).max(60),
  displayPhoneNumber: z.string().max(30).optional(),
  accessToken: z.string().min(20).max(4000),
});

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
