import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getBusinessInOrg, withBusinessScope } from "@/lib/tenant-db";
import { parseCsvRecords } from "@/lib/csv";
import { recordLeadEvent } from "@/lib/lead-events";

const ImportSchema = z.object({ csv: z.string().min(1) });

const MAX_ROWS = 2000;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id: businessId } = await context.params;
  const business = await getBusinessInOrg(user.organizationId, businessId);
  if (!business) return NextResponse.json({ error: "Business not found." }, { status: 404 });

  const body = await request.json().catch(() => null);
  const parsed = ImportSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Paste CSV text to import." }, { status: 400 });
  }

  const records = parseCsvRecords(parsed.data.csv);
  if (records.length === 0) {
    return NextResponse.json({ error: "No rows found. Expect a header row with name/email/phone/company columns." }, { status: 400 });
  }
  if (records.length > MAX_ROWS) {
    return NextResponse.json({ error: `Too many rows (max ${MAX_ROWS} per import).` }, { status: 400 });
  }

  const rowsWithContact = records.filter((r) => r.name || r.email || r.phone);
  if (rowsWithContact.length === 0) {
    return NextResponse.json(
      { error: "No usable rows — every row needs at least a name, email, or phone column." },
      { status: 400 }
    );
  }

  const result = await withBusinessScope(user.organizationId, businessId, async (tx) => {
    let source = await tx.leadSource.findFirst({ where: { businessId, channel: "csv" } });
    if (!source) {
      source = await tx.leadSource.create({
        data: { businessId, channel: "csv", name: "CSV import" },
      });
    }

    let created = 0;
    for (const record of rowsWithContact) {
      const lead = await tx.lead.create({
        data: {
          businessId,
          sourceId: source.id,
          name: record.name || undefined,
          email: record.email || undefined,
          phone: record.phone || undefined,
          company: record.company || undefined,
        },
      });
      await recordLeadEvent(tx, {
        businessId,
        leadId: lead.id,
        type: "lead_created",
        payload: { source: "csv" },
      });
      created++;
    }

    return { created, skipped: records.length - rowsWithContact.length };
  });

  return NextResponse.json(result, { status: 201 });
}
