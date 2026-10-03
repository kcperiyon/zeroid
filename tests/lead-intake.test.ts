// Verifies the shared lead-ingestion rules: repeat contacts merge instead of
// duplicating, first-touch medium/campaign is kept, redelivered webhook ids
// are ignored, and the public intake-key / Meta-account RLS lookups only open
// the one row they name.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../src/lib/db";
import { withOrgScope, withBusinessScope, withIntakeKeyScope, withMetaAccountScope } from "../src/lib/tenant-db";
import { ingestLead } from "../src/lib/lead-intake";

let org: { id: string };
let business: { id: string };
let otherOrg: { id: string };
let otherBusiness: { id: string };
const tag = Date.now();

beforeAll(async () => {
  org = await db.organization.create({ data: { name: "Intake Test", slug: `intake-${tag}` } });
  business = await withOrgScope(org.id, (tx) => tx.business.create({ data: { organizationId: org.id, name: "B1" } }));
  otherOrg = await db.organization.create({ data: { name: "Intake Other", slug: `intake-other-${tag}` } });
  otherBusiness = await withOrgScope(otherOrg.id, (tx) =>
    tx.business.create({ data: { organizationId: otherOrg.id, name: "B2" } })
  );
  await withBusinessScope(org.id, business.id, async (tx) => {
    await tx.intakeKey.create({ data: { businessId: business.id, organizationId: org.id, publicKey: `key-a-${tag}` } });
    await tx.metaConnection.create({
      data: {
        businessId: business.id,
        organizationId: org.id,
        pageId: `page-a-${tag}`,
        instagramAccountId: `ig-a-${tag}`,
        pageAccessToken: "t".repeat(24),
      },
    });
  });
  await withBusinessScope(otherOrg.id, otherBusiness.id, async (tx) => {
    await tx.intakeKey.create({
      data: { businessId: otherBusiness.id, organizationId: otherOrg.id, publicKey: `key-b-${tag}` },
    });
  });
});

afterAll(async () => {
  for (const [o, b] of [
    [org, business],
    [otherOrg, otherBusiness],
  ] as const) {
    await withBusinessScope(o.id, b.id, async (tx) => {
      await tx.task.deleteMany({ where: { businessId: b.id } });
      await tx.leadEvent.deleteMany({ where: { businessId: b.id } });
      await tx.lead.deleteMany({ where: { businessId: b.id } });
      await tx.leadSource.deleteMany({ where: { businessId: b.id } });
      await tx.intakeKey.deleteMany({ where: { businessId: b.id } });
      await tx.metaConnection.deleteMany({ where: { businessId: b.id } });
    });
    await withOrgScope(o.id, (tx) => tx.business.deleteMany({ where: { organizationId: o.id } }));
    await db.organization.delete({ where: { id: o.id } });
  }
});

const run = (input: Parameters<typeof ingestLead>[2]) =>
  withBusinessScope(org.id, business.id, (tx) => ingestLead(tx, business.id, input));

describe("ingestLead", () => {
  it("creates a lead, then merges a repeat email (case-insensitive) into it and keeps first-touch medium", async () => {
    const first = await run({ channel: "webhook", medium: "paid", campaign: "launch", name: "Ada", email: "Ada@Example.com" });
    expect(first.created).toBe(true);

    const second = await run({ channel: "api", medium: "organic", email: "ada@example.com", message: "again" });
    expect(second.created).toBe(false);
    expect(second.leadId).toBe(first.leadId);

    const lead = await withBusinessScope(org.id, business.id, (tx) =>
      tx.lead.findFirst({ where: { id: first.leadId }, include: { events: true } })
    );
    expect(lead?.medium).toBe("paid");
    expect(lead?.campaign).toBe("launch");
    expect(lead?.events.map((e) => e.type).sort()).toEqual(["lead_created", "lead_inbound"]);
  });

  it("recognises a social contact by id and ignores a redelivered message id", async () => {
    const a = await run({
      channel: "instagram",
      medium: "organic",
      name: "bola",
      socialId: "S9",
      message: "hi",
      dedupeId: "instagram:m1",
      createReplyTask: true,
    });
    expect(a.created).toBe(true);

    const redelivered = await run({
      channel: "instagram",
      medium: "organic",
      socialId: "S9",
      message: "hi",
      dedupeId: "instagram:m1",
    });
    expect(redelivered.duplicate).toBe(true);

    const next = await run({
      channel: "instagram",
      medium: "organic",
      socialId: "S9",
      message: "price?",
      dedupeId: "instagram:m2",
    });
    expect(next).toMatchObject({ created: false, duplicate: false, leadId: a.leadId });

    const tasks = await withBusinessScope(org.id, business.id, (tx) => tx.task.count({ where: { leadId: a.leadId } }));
    expect(tasks).toBe(1);
  });
});

describe("public lookups stay narrow (RLS)", () => {
  it("an intake key opens only its own row", async () => {
    const own = await withIntakeKeyScope(`key-a-${tag}`, (tx) => tx.intakeKey.findMany());
    expect(own.map((k) => k.businessId)).toEqual([business.id]);
    const none = await withIntakeKeyScope("not-a-key", (tx) => tx.intakeKey.findMany());
    expect(none).toEqual([]);
  });

  it("a Meta account id opens only the matching connection, by Page id or Instagram id", async () => {
    for (const id of [`page-a-${tag}`, `ig-a-${tag}`]) {
      const rows = await withMetaAccountScope(id, (tx) => tx.metaConnection.findMany());
      expect(rows.map((r) => r.businessId)).toEqual([business.id]);
    }
    expect(await withMetaAccountScope("nope", (tx) => tx.metaConnection.findMany())).toEqual([]);
  });
});
