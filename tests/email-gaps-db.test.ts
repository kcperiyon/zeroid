// Database-backed tests for the Phase 1 gap features: encrypted credentials, identity / campaign /
// segment / suppression management rules (real route handlers), bulk prospect import, A/B subjects
// with per-step stats, and the IMAP mailbox poller (against a fake mailbox).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const holder = vi.hoisted(() => ({ ctx: null as null | { organizationId: string; businessId: string; role: string } }));
vi.mock("@/lib/api-auth", () => ({
  CAMPAIGN_ROLES: ["owner", "admin", "manager", "marketing"],
  authorizeBusiness: async (_ctx: unknown, allowed: string[]) => {
    const c = holder.ctx!;
    if (!allowed.includes(c.role)) return { error: new Response(JSON.stringify({ error: "You do not have permission to do that." }), { status: 403 }) };
    return { user: { organizationId: c.organizationId, role: c.role, id: "u", email: "t@t", name: "t" }, businessId: c.businessId };
  },
}));
const created: Record<string, unknown>[] = [];
vi.mock("nodemailer", () => ({
  default: {
    createTransport: (opts: Record<string, unknown>) => {
      created.push(opts);
      return { sendMail: async () => ({ messageId: "<fake@x>" }) };
    },
  },
}));

import { db } from "../src/lib/db";
import { withBusinessScope, withOrgScope } from "../src/lib/tenant-db";
import { launchCampaign, pauseCampaign, processDueMessages, stepStats, type EngineDeps } from "../src/lib/email-campaigns/engine";
import { smtpSender, type EmailSender, type SenderIdentity } from "../src/lib/email-campaigns/senders";
import { isEncrypted, decryptSecret, encryptSecret } from "../src/lib/secrets";
import { upgradeIdentitySecrets } from "../src/lib/email-campaigns/upgrade-secrets";
import { pollBusinessMailboxes, type MailboxSession } from "../src/lib/email-campaigns/mailbox";
import { importProspectAsLead } from "../src/lib/prospect-import";
import * as identitiesRoute from "../src/app/api/businesses/[id]/identities/route";
import * as identityRoute from "../src/app/api/businesses/[id]/identities/[identityId]/route";
import * as campaignRoute from "../src/app/api/businesses/[id]/campaigns/[campaignId]/route";
import * as duplicateRoute from "../src/app/api/businesses/[id]/campaigns/[campaignId]/duplicate/route";
import * as segmentRoute from "../src/app/api/businesses/[id]/segments/[segmentId]/route";
import * as suppressionsRoute from "../src/app/api/businesses/[id]/suppressions/route";
import * as bulkImportRoute from "../src/app/api/businesses/[id]/prospects/import-bulk/route";

const tag = Date.now();
const MON = new Date("2026-10-26T11:00:00Z");
const LATER = new Date("2026-10-27T11:00:00Z");

type T = { orgId: string; businessId: string; identityId: string; segmentId: string; campaignId: string; stepIds: string[] };
const tenants: T[] = [];
let T1: T;

const sent: { to: string; subject: string }[] = [];
const fake: EmailSender = {
  async send(_i, e) {
    sent.push({ to: e.to, subject: e.subject });
    return { mode: "live" };
  },
};
const deps = (now: Date, over: Partial<EngineDeps> = {}): EngineDeps => ({
  now: () => now, baseUrl: "https://zeroid.test", mxCheck: async () => true, senders: { brevo_shared: fake, smtp: fake }, ...over,
});

async function purge(t: T) {
  await withBusinessScope(t.orgId, t.businessId, async (tx) => {
    await tx.emailEvent.deleteMany({ where: { businessId: t.businessId } });
    await tx.campaignMessage.deleteMany({ where: { businessId: t.businessId } });
    await tx.sequenceStep.deleteMany({ where: { businessId: t.businessId } });
    await tx.sequence.deleteMany({ where: { businessId: t.businessId } });
    await tx.campaign.deleteMany({ where: { businessId: t.businessId } });
    await tx.segment.deleteMany({ where: { businessId: t.businessId } });
    await tx.sendingIdentity.deleteMany({ where: { businessId: t.businessId } });
    await tx.task.deleteMany({ where: { businessId: t.businessId } });
    await tx.leadEvent.deleteMany({ where: { businessId: t.businessId } });
    await tx.prospect.deleteMany({ where: { businessId: t.businessId } });
    await tx.lead.deleteMany({ where: { businessId: t.businessId } });
    await tx.leadSource.deleteMany({ where: { businessId: t.businessId } });
    await tx.suppression.deleteMany({ where: { businessId: t.businessId } });
  });
  await withOrgScope(t.orgId, (tx) => tx.business.deleteMany({ where: { organizationId: t.orgId } }));
  await db.organization.deleteMany({ where: { id: t.orgId } });
}

async function makeTenant(label: string, opts: { provider?: "smtp" | "brevo_shared"; subjectB?: string } = {}): Promise<T> {
  const org = await db.organization.create({ data: { name: `Gap ${label}`, slug: `gap-${label}-${tag}` } });
  const business = await withOrgScope(org.id, (tx) => tx.business.create({ data: { organizationId: org.id, name: `Biz ${label}` } }));
  const parts = await withBusinessScope(org.id, business.id, async (tx) => {
    const identity = await tx.sendingIdentity.create({
      data: { businessId: business.id, name: "Main", provider: opts.provider ?? "smtp", fromEmail: `hello@${label}.example`, fromName: `Team ${label}`, physicalAddress: "1 Test Street, Lagos", sandboxOnly: false, dailyCap: 500, perDomainHourlyCap: 500 },
    });
    const segment = await tx.segment.create({ data: { businessId: business.id, name: "All", filter: {} } });
    const campaign = await tx.campaign.create({ data: { businessId: business.id, organizationId: org.id, name: "C", segmentId: segment.id, identityId: identity.id, timezone: "UTC", sendStartHour: 0, sendEndHour: 24, weekdaysOnly: false } });
    const seq = await tx.sequence.create({ data: { businessId: business.id, campaignId: campaign.id, name: "S" } });
    const s1 = await tx.sequenceStep.create({ data: { businessId: business.id, sequenceId: seq.id, position: 1, delayDays: 0, subject: "Subject A {{firstName}}", subjectB: opts.subjectB, body: "Hello {{firstName}}" } });
    const s2 = await tx.sequenceStep.create({ data: { businessId: business.id, sequenceId: seq.id, position: 2, delayDays: 2, subject: "Follow up", body: "Again" } });
    return { identityId: identity.id, segmentId: segment.id, campaignId: campaign.id, stepIds: [s1.id, s2.id] };
  });
  const t = { orgId: org.id, businessId: business.id, ...parts };
  tenants.push(t);
  return t;
}
const as = (t: T, role = "owner") => (holder.ctx = { organizationId: t.orgId, businessId: t.businessId, role });
const ctx = (extra: Record<string, string> = {}): never => ({ params: Promise.resolve({ id: "x", ...extra }) }) as never;
const req = (method: string, body?: unknown, url = "http://t/x") =>
  new Request(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const addLead = (t: T, name: string, email: string | null) =>
  withBusinessScope(t.orgId, t.businessId, (tx) => tx.lead.create({ data: { businessId: t.businessId, name, email, company: `${name} Co` } }));

beforeAll(async () => {
  process.env.SECRETS_KEY = "gap-tests-secrets-key";
  process.env.EMAIL_LINK_SECRET = "gap-tests-link-secret";
  T1 = await makeTenant("t1");
});
afterAll(async () => {
  for (const t of tenants) await purge(t);
});

describe("encrypted credentials", () => {
  it("creating an identity encrypts secrets at rest and never returns them", async () => {
    as(T1, "owner");
    const res = await identitiesRoute.POST(req("POST", {
      name: "Own", provider: "smtp", fromEmail: "a@own.example", fromName: "Own", physicalAddress: "5 Road, Lagos, Nigeria",
      smtpHost: "smtp.own.example", smtpUser: "u", smtpPass: "smtp-secret-pw", dkimPrivateKey: "PEM-SECRET", imapHost: "imap.own.example", imapUser: "u", imapPass: "imap-secret-pw",
    }), ctx());
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toMatch(/secret-pw|PEM-SECRET/);
    expect(body.identity).toMatchObject({ hasSmtpPassword: true, hasDkimKey: true, hasImapPassword: true, sandboxOnly: true });

    const row = await withBusinessScope(T1.orgId, T1.businessId, (tx) => tx.sendingIdentity.findFirst({ where: { id: body.identity.id } }));
    for (const v of [row!.smtpPass, row!.dkimPrivateKey, row!.imapPass]) expect(isEncrypted(v)).toBe(true);
    expect(decryptSecret(row!.smtpPass!)).toBe("smtp-secret-pw");
    expect(row!.smtpPass).not.toContain("smtp-secret-pw");
  });

  it("the SMTP sender decrypts credentials when it connects, and legacy plaintext still works", async () => {
    created.length = 0;
    const base: SenderIdentity = { provider: "smtp", sandboxOnly: false, fromEmail: "a@b.example", fromName: "A", smtpHost: "h", smtpUser: "u", smtpPass: encryptSecret("real-password"), dkimDomain: "b.example", dkimSelector: "s1", dkimPrivateKey: encryptSecret("REAL-PEM") };
    process.env.CAMPAIGN_ALLOW_LIVE_SENDING = "true";
    await smtpSender.send(base, { to: "x@y.example", subject: "s", text: "t", html: "h", headers: {}, replyTo: "a@b.example", messageId: "<m@b>" });
    await smtpSender.send({ ...base, smtpPass: "plain-legacy", dkimPrivateKey: "LEGACY-PEM" }, { to: "x@y.example", subject: "s", text: "t", html: "h", headers: {}, replyTo: "a@b.example", messageId: "<m2@b>" });
    delete process.env.CAMPAIGN_ALLOW_LIVE_SENDING;
    expect((created[0].auth as { pass: string }).pass).toBe("real-password");
    expect((created[0].dkim as { privateKey: string }).privateKey).toBe("REAL-PEM");
    expect((created[1].auth as { pass: string }).pass).toBe("plain-legacy");
  });

  it("the start-up upgrade encrypts legacy plaintext rows once, then does nothing", async () => {
    const t = await makeTenant("legacy");
    await withBusinessScope(t.orgId, t.businessId, (tx) => tx.sendingIdentity.update({ where: { id: t.identityId }, data: { smtpPass: "old-plain-pass", imapPass: "old-imap" } }));
    expect(await upgradeIdentitySecrets()).toBeGreaterThanOrEqual(1);
    const row = await withBusinessScope(t.orgId, t.businessId, (tx) => tx.sendingIdentity.findFirst({ where: { id: t.identityId } }));
    expect(isEncrypted(row!.smtpPass)).toBe(true);
    expect(decryptSecret(row!.smtpPass!)).toBe("old-plain-pass");
    expect(await upgradeIdentitySecrets()).toBe(0);
  });
});

describe("identity management rules", () => {
  it("only an owner can take an identity out of sandbox; an admin cannot", async () => {
    const t = await makeTenant("idrules");
    // An SMTP identity can only go live if it actually has a server to send through.
    await withBusinessScope(t.orgId, t.businessId, (tx) => tx.sendingIdentity.update({ where: { id: t.identityId }, data: { sandboxOnly: true, smtpHost: "smtp.own.example" } }));
    as(t, "admin");
    const denied = await identityRoute.PATCH(req("PATCH", { sandboxOnly: false }), ctx({ identityId: t.identityId }));
    expect(denied.status).toBe(403);
    as(t, "owner");
    const ok = await identityRoute.PATCH(req("PATCH", { sandboxOnly: false }), ctx({ identityId: t.identityId }));
    expect(ok.status).toBe(200);
    // And an SMTP identity with no server cannot be taken live at all.
    const bare = await makeTenant("idbare");
    as(bare, "owner");
    const refused = await identityRoute.PATCH(req("PATCH", { sandboxOnly: false }), ctx({ identityId: bare.identityId }));
    expect(refused.status).toBe(400);
  });

  it("the shared Brevo identity can never leave sandbox, and switching to it re-locks sandbox", async () => {
    const t = await makeTenant("brevolock", { provider: "brevo_shared" });
    as(t, "owner");
    const r = await identityRoute.PATCH(req("PATCH", { sandboxOnly: false }), ctx({ identityId: t.identityId }));
    expect(r.status).toBe(400);
    const t2 = await makeTenant("relock");
    as(t2, "owner");
    await identityRoute.PATCH(req("PATCH", { sandboxOnly: false }), ctx({ identityId: t2.identityId }));
    const back = await identityRoute.PATCH(req("PATCH", { provider: "brevo_shared" }), ctx({ identityId: t2.identityId }));
    expect(back.status).toBe(200);
    expect((await back.json()).identity.sandboxOnly).toBe(true);
  });

  it("a blank secret on update keeps the stored one; a new one replaces it (encrypted)", async () => {
    const t = await makeTenant("keepsecret");
    await withBusinessScope(t.orgId, t.businessId, (tx) => tx.sendingIdentity.update({ where: { id: t.identityId }, data: { smtpHost: "h", smtpPass: encryptSecret("first-pass") } }));
    as(t, "owner");
    await identityRoute.PATCH(req("PATCH", { name: "Renamed", smtpPass: "" }), ctx({ identityId: t.identityId }));
    let row = await withBusinessScope(t.orgId, t.businessId, (tx) => tx.sendingIdentity.findFirst({ where: { id: t.identityId } }));
    expect(row!.name).toBe("Renamed");
    expect(decryptSecret(row!.smtpPass!)).toBe("first-pass");
    await identityRoute.PATCH(req("PATCH", { smtpPass: "second-pass" }), ctx({ identityId: t.identityId }));
    row = await withBusinessScope(t.orgId, t.businessId, (tx) => tx.sendingIdentity.findFirst({ where: { id: t.identityId } }));
    expect(decryptSecret(row!.smtpPass!)).toBe("second-pass");
  });

  it("cannot delete an identity a campaign uses; can once the campaign is gone", async () => {
    const t = await makeTenant("iddelete");
    as(t, "owner");
    expect((await identityRoute.DELETE(req("DELETE"), ctx({ identityId: t.identityId }))).status).toBe(409);
    expect((await campaignRoute.DELETE(req("DELETE"), ctx({ campaignId: t.campaignId }))).status).toBe(200);
    expect((await identityRoute.DELETE(req("DELETE"), ctx({ identityId: t.identityId }))).status).toBe(200);
  });
});

describe("campaign and segment management", () => {
  it("refuses to delete a running campaign; deleting a stopped one removes messages and events too", async () => {
    const t = await makeTenant("cdel");
    await addLead(t, "ada", "ada@c.example");
    await launchCampaign(t.orgId, t.businessId, t.campaignId, deps(MON));
    as(t, "owner");
    expect((await campaignRoute.DELETE(req("DELETE"), ctx({ campaignId: t.campaignId }))).status).toBe(409);
    await pauseCampaign(t.orgId, t.businessId, t.campaignId);
    expect((await campaignRoute.DELETE(req("DELETE"), ctx({ campaignId: t.campaignId }))).status).toBe(200);
    const left = await withBusinessScope(t.orgId, t.businessId, async (tx) => ({
      campaigns: await tx.campaign.count(), messages: await tx.campaignMessage.count(), steps: await tx.sequenceStep.count(),
    }));
    expect(left).toEqual({ campaigns: 0, messages: 0, steps: 0 });
  });

  it("duplicates a campaign as a fresh draft with the same steps, including the B subject", async () => {
    const t = await makeTenant("cdup", { subjectB: "Subject B" });
    as(t, "owner");
    const res = await duplicateRoute.POST(req("POST"), ctx({ campaignId: t.campaignId }));
    expect(res.status).toBe(201);
    const copy = (await res.json()).campaign;
    const steps = await withBusinessScope(t.orgId, t.businessId, (tx) => tx.sequenceStep.findMany({ where: { sequence: { campaignId: copy.id } }, orderBy: { position: "asc" } }));
    expect(copy.status).toBe("draft");
    expect(steps.map((s) => s.subjectB)).toEqual(["Subject B", null]);
    expect(steps).toHaveLength(2);
  });

  it("editing steps (with a B subject) works on a draft and is refused once launched", async () => {
    const t = await makeTenant("cedit");
    as(t, "owner");
    const ok = await campaignRoute.PATCH(req("PATCH", { steps: [{ delayDays: 0, subject: "A", subjectB: "B", body: "x", aiPersonalise: false }, { delayDays: 3, subject: "C", body: "y", aiPersonalise: false }] }), ctx({ campaignId: t.campaignId }));
    expect(ok.status).toBe(200);
    const steps = await withBusinessScope(t.orgId, t.businessId, (tx) => tx.sequenceStep.findMany({ orderBy: { position: "asc" } }));
    expect(steps.map((s) => [s.subject, s.subjectB, s.delayDays])).toEqual([["A", "B", 0], ["C", null, 3]]);
    await addLead(t, "z", "z@c.example");
    await launchCampaign(t.orgId, t.businessId, t.campaignId, deps(MON));
    await pauseCampaign(t.orgId, t.businessId, t.campaignId);
    const refused = await campaignRoute.PATCH(req("PATCH", { steps: [{ delayDays: 0, subject: "Z", body: "z", aiPersonalise: false }] }), ctx({ campaignId: t.campaignId }));
    expect(refused.status).toBe(409);
  });

  it("segments: cannot delete one a campaign uses; cannot change the filter while a campaign runs", async () => {
    const t = await makeTenant("seg");
    as(t, "owner");
    expect((await segmentRoute.DELETE(req("DELETE"), ctx({ segmentId: t.segmentId }))).status).toBe(409);
    expect((await segmentRoute.PATCH(req("PATCH", { name: "Renamed" }), ctx({ segmentId: t.segmentId }))).status).toBe(200);
    await addLead(t, "z", "z@c.example");
    await launchCampaign(t.orgId, t.businessId, t.campaignId, deps(MON));
    expect((await segmentRoute.PATCH(req("PATCH", { filter: { stages: ["hot"] } }), ctx({ segmentId: t.segmentId }))).status).toBe(409);
  });
});

describe("suppression list management", () => {
  it("pasting emails suppresses them and cancels their pending messages; entries can be removed again", async () => {
    const t = await makeTenant("supp");
    await addLead(t, "keep", "keep@c.example");
    await addLead(t, "stop", "stop@c.example");
    await launchCampaign(t.orgId, t.businessId, t.campaignId, deps(MON));
    as(t, "owner");
    const res = await suppressionsRoute.POST(req("POST", { emails: "stop@c.example, not-an-email\nSTOP@C.EXAMPLE" }), ctx());
    expect(await res.json()).toEqual({ added: 1, ignored: 1 });
    const msgs = await withBusinessScope(t.orgId, t.businessId, (tx) => tx.campaignMessage.findMany());
    expect(msgs.find((m) => m.toEmail === "stop@c.example")?.status).toBe("cancelled");
    expect(msgs.find((m) => m.toEmail === "keep@c.example")?.status).toBe("scheduled");

    const list = await (await suppressionsRoute.GET(req("GET"), ctx())).json();
    expect(list.suppressions.map((s: { email: string }) => s.email)).toEqual(["stop@c.example"]);
    const del = await suppressionsRoute.DELETE(req("DELETE", undefined, "http://t/x?email=stop@c.example"), ctx());
    expect(del.status).toBe(200);
  });

  it("hard bounces and complaints cannot be removed from the list", async () => {
    const t = await makeTenant("suppbounce");
    await withBusinessScope(t.orgId, t.businessId, (tx) => tx.suppression.create({ data: { businessId: t.businessId, email: "bounced@c.example", reason: "hard_bounce" } }));
    as(t, "owner");
    const del = await suppressionsRoute.DELETE(req("DELETE", undefined, "http://t/x?email=bounced@c.example"), ctx());
    expect(del.status).toBe(404);
  });

  it("a role without access is refused", async () => {
    as(T1, "viewer");
    expect((await suppressionsRoute.POST(req("POST", { emails: "a@b.co" }), ctx())).status).toBe(403);
  });
});

describe("bulk prospect import", () => {
  it("imports only prospects with a usable email by default, and is idempotent", async () => {
    const t = await makeTenant("bulk");
    await withBusinessScope(t.orgId, t.businessId, async (tx) => {
      const base = { businessId: t.businessId, channel: "google" as const };
      await tx.prospect.create({ data: { ...base, externalId: "p1", name: "Has Email", email: "info@hasemail.example" } });
      await tx.prospect.create({ data: { ...base, externalId: "p2", name: "No Email" } });
      await tx.prospect.create({ data: { ...base, externalId: "p3", name: "Bad Email", email: "not-an-email" } });
    });
    as(t, "manager");
    const first = await (await bulkImportRoute.POST(req("POST", {}), ctx())).json();
    expect(first).toEqual({ imported: 1, skippedNoEmail: 2, considered: 3 });
    const second = await (await bulkImportRoute.POST(req("POST", {}), ctx())).json();
    expect(second.imported).toBe(0);
    const leads = await withBusinessScope(t.orgId, t.businessId, (tx) => tx.lead.findMany());
    expect(leads.map((l) => l.email)).toEqual(["info@hasemail.example"]);
    const all = await (await bulkImportRoute.POST(req("POST", { onlyWithEmail: false }), ctx())).json();
    expect(all.imported).toBe(2);
  });

  it("importProspectAsLead returns an already-imported prospect untouched", async () => {
    const t = await makeTenant("bulk2");
    const p = await withBusinessScope(t.orgId, t.businessId, (tx) => tx.prospect.create({ data: { businessId: t.businessId, channel: "news", externalId: "n1", name: "N", email: "n@n.example" } }));
    await withBusinessScope(t.orgId, t.businessId, async (tx) => {
      await importProspectAsLead(tx, t.businessId, p.id);
      const again = await importProspectAsLead(tx, t.businessId, p.id);
      expect(again?.status).toBe("imported");
      expect(await tx.lead.count()).toBe(1);
    });
  });
});

describe("A/B subjects and per-step stats", () => {
  it("splits recipients between the two subject lines, records the variant, and reports per-variant stats", async () => {
    const t = await makeTenant("ab", { subjectB: "Subject B {{firstName}}" });
    for (let i = 0; i < 24; i++) await addLead(t, `lead${i}`, `lead${i}@ab.example`);
    await launchCampaign(t.orgId, t.businessId, t.campaignId, deps(MON));
    sent.length = 0;
    await processDueMessages(t.orgId, t.businessId, deps(LATER));
    expect(sent).toHaveLength(24);
    const a = sent.filter((e) => e.subject.startsWith("Subject A")).length;
    const b = sent.filter((e) => e.subject.startsWith("Subject B")).length;
    expect(a + b).toBe(24);
    expect(a).toBeGreaterThan(3);
    expect(b).toBeGreaterThan(3);

    const msgs = await withBusinessScope(t.orgId, t.businessId, (tx) => tx.campaignMessage.findMany({ where: { status: "sent", step: { position: 1 } } }));
    expect(msgs.every((m) => m.variant === "A" || m.variant === "B")).toBe(true);
    // The step-2 follow-up has no B subject, so it has no variant.
    const step2 = await withBusinessScope(t.orgId, t.businessId, (tx) => tx.campaignMessage.findMany({ where: { step: { position: 2 } } }));
    expect(step2.every((m) => m.variant === null)).toBe(true);

    // Open some and reply to one, then read the funnel.
    await withBusinessScope(t.orgId, t.businessId, async (tx) => {
      for (const m of msgs.slice(0, 5)) await tx.emailEvent.create({ data: { businessId: t.businessId, campaignId: t.campaignId, messageId: m.id, leadId: m.leadId, type: "opened" } });
      await tx.emailEvent.create({ data: { businessId: t.businessId, campaignId: t.campaignId, messageId: msgs[0].id, leadId: msgs[0].leadId, type: "opened" } }); // repeat open counts once
      await tx.emailEvent.create({ data: { businessId: t.businessId, campaignId: t.campaignId, messageId: msgs[0].id, leadId: msgs[0].leadId, type: "replied" } });
    });
    const rows = await withBusinessScope(t.orgId, t.businessId, (tx) => stepStats(tx, t.campaignId));
    const s1 = rows.filter((r) => r.position === 1);
    expect(s1.map((r) => r.variant).sort()).toEqual(["A", "B"]);
    expect(s1.reduce((n, r) => n + r.sent, 0)).toBe(24);
    expect(s1.reduce((n, r) => n + r.opened, 0)).toBe(5);
    expect(s1.reduce((n, r) => n + r.replied, 0)).toBe(1);
    const s2 = rows.filter((r) => r.position === 2);
    expect(s2).toHaveLength(1);
    expect(s2[0].scheduled).toBe(24);
  });
});

describe("mailbox poller (IMAP, read-only)", () => {
  async function imapTenant(label: string) {
    const t = await makeTenant(label);
    await withBusinessScope(t.orgId, t.businessId, (tx) =>
      tx.sendingIdentity.update({ where: { id: t.identityId }, data: { imapHost: "imap.fake.example", imapUser: "inbox@fake.example", imapPass: encryptSecret("imap-pw"), imapFolder: "INBOX" } })
    );
    await addLead(t, "pat lee", "pat@c.example");
    await launchCampaign(t.orgId, t.businessId, t.campaignId, deps(MON));
    await processDueMessages(t.orgId, t.businessId, deps(LATER));
    const msg = await withBusinessScope(t.orgId, t.businessId, (tx) => tx.campaignMessage.findFirst({ where: { step: { position: 1 } } }));
    return { t, msg: msg! };
  }
  const reply = (token: string, text: string) => Buffer.from(`From: Pat <pat@c.example>\nTo: inbox+${token}@fake.example\nSubject: Re: hi\nContent-Type: text/plain\n\n${text}\n`);

  it("reads new messages, hands them to the inbound handler, remembers the highest UID, and respects the poll interval", async () => {
    const { t, msg } = await imapTenant("imap1");
    const calls: { afterUid: number | null; since: Date; pass?: string }[] = [];
    let opened: { pass: string } | null = null;
    const open = async (cfg: { pass: string }): Promise<MailboxSession> => {
      opened = cfg;
      return {
        async fetchNew(o) {
          calls.push({ afterUid: o.afterUid, since: o.since });
          return o.afterUid == null ? [{ uid: 7, source: reply(msg.token, "Yes, interested! Let us talk this week.") }, { uid: 9, source: Buffer.from("From: x@y.example\nTo: me@fake.example\nSubject: unrelated\n\nhi\n") }] : [];
        },
        async close() {},
      };
    };
    const now = new Date("2026-10-27T12:00:00Z");
    const r1 = await pollBusinessMailboxes(t.orgId, t.businessId, { open, now: () => now });
    expect(r1).toMatchObject({ fetched: 2, matched: 1, replies: 1 });
    expect(opened!.pass).toBe("imap-pw"); // decrypted before connecting
    expect(calls[0].afterUid).toBeNull();
    expect(now.getTime() - calls[0].since.getTime()).toBe(3 * 86_400_000);

    const id = await withBusinessScope(t.orgId, t.businessId, (tx) => tx.sendingIdentity.findFirst({ where: { id: t.identityId } }));
    expect(id!.imapLastUid).toBe(9);
    expect(id!.imapLastError).toBeNull();
    const tasks = await withBusinessScope(t.orgId, t.businessId, (tx) => tx.task.findMany());
    expect(tasks.some((x) => /Interested reply/.test(x.title))).toBe(true);

    // Too soon: skipped entirely. Later: continues after UID 9.
    expect((await pollBusinessMailboxes(t.orgId, t.businessId, { open, now: () => new Date(now.getTime() + 20_000) })).fetched).toBe(0);
    expect(calls).toHaveLength(1);
    await pollBusinessMailboxes(t.orgId, t.businessId, { open, now: () => new Date(now.getTime() + 120_000) });
    expect(calls[1].afterUid).toBe(9);
  });

  it("a login failure is recorded on the identity without leaking credentials, and does not stop the worker", async () => {
    const { t } = await imapTenant("imap2");
    const open = async () => {
      throw new Error("Invalid credentials (Failure)");
    };
    const r = await pollBusinessMailboxes(t.orgId, t.businessId, { open, now: () => new Date("2026-10-27T12:00:00Z") });
    expect(r.error).toMatch(/Invalid credentials/);
    const id = await withBusinessScope(t.orgId, t.businessId, (tx) => tx.sendingIdentity.findFirst({ where: { id: t.identityId } }));
    expect(id!.imapLastError).toMatch(/Invalid credentials/);
    expect(id!.imapLastError).not.toMatch(/imap-pw/);
  });

  it("a malformed message does not stop the rest of the batch", async () => {
    const { t, msg } = await imapTenant("imap3");
    const open = async (): Promise<MailboxSession> => ({
      async fetchNew() {
        return [{ uid: 1, source: Buffer.alloc(0) }, { uid: 2, source: reply(msg.token, "Not right now, maybe next quarter.") }];
      },
      async close() {},
    });
    const r = await pollBusinessMailboxes(t.orgId, t.businessId, { open, now: () => new Date("2026-10-27T12:00:00Z") });
    expect(r.replies).toBe(1);
  });
});
