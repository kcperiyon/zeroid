// End-to-end tests of the campaign engine against the real database: launch, scheduling,
// suppression, caps, the sandbox guard, unsubscribe, bounces/replies, and tenant isolation (RLS).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "../src/lib/db";
import { withBusinessScope, withMessageLookupScope, withOrgScope } from "../src/lib/tenant-db";
import { launchCampaign, pauseCampaign, processDueMessages, type EngineDeps } from "../src/lib/email-campaigns/engine";
import { SENDERS, type EmailSender, type OutgoingEmail, type SenderIdentity } from "../src/lib/email-campaigns/senders";
import { SandboxBlockedError } from "../src/lib/email-campaigns/guard";
import { addSuppression } from "../src/lib/email-campaigns/suppression";
import { unsubscribeByToken } from "../src/lib/email-campaigns/unsubscribe";
import { handleInboundEmail } from "../src/lib/email-campaigns/inbound";

const tag = Date.now();
const MONDAY_11 = new Date("2026-10-26T11:00:00Z"); // Monday, inside a 09-17 UTC window
const SATURDAY = new Date("2026-10-24T11:00:00Z");

type Tenant = { orgId: string; businessId: string; identityId: string; segmentId: string; campaignId: string; steps: string[] };
let A: Tenant;
let B: Tenant;
const leadIds: Record<string, string> = {};
const allTenants: Tenant[] = [];

/** Deletes everything a test tenant created. Safe to call twice. */
async function purge(t: Tenant) {
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
    await tx.lead.deleteMany({ where: { businessId: t.businessId } });
    await tx.suppression.deleteMany({ where: { businessId: t.businessId } });
  });
  await withOrgScope(t.orgId, (tx) => tx.business.deleteMany({ where: { organizationId: t.orgId } }));
  await db.organization.deleteMany({ where: { id: t.orgId } });
}

const sent: OutgoingEmail[] = [];
const fakeSender: EmailSender = {
  async send(_identity: SenderIdentity, email: OutgoingEmail) {
    sent.push(email);
    return { mode: "live", providerId: "fake" };
  },
};
const deps = (now: Date, over: Partial<EngineDeps> = {}): EngineDeps => ({
  now: () => now,
  baseUrl: "https://zeroid.test",
  mxCheck: async (d) => d !== "nodomain.invalid",
  senders: { brevo_shared: fakeSender, smtp: fakeSender },
  ...over,
});

async function makeTenant(label: string, provider: "smtp" | "brevo_shared" = "smtp"): Promise<Tenant> {
  const org = await db.organization.create({ data: { name: `Camp ${label}`, slug: `camp-${label}-${tag}` } });
  const business = await withOrgScope(org.id, (tx) => tx.business.create({ data: { organizationId: org.id, name: `Biz ${label}` } }));
  const t = await withBusinessScope(org.id, business.id, async (tx) => {
    const identity = await tx.sendingIdentity.create({
      data: {
        businessId: business.id, name: "Main", provider, fromEmail: `hello@${label}.example`, fromName: `Team ${label}`,
        physicalAddress: "1 Test Street, Lagos", sandboxOnly: false, dailyCap: 100, perDomainHourlyCap: 50,
      },
    });
    const segment = await tx.segment.create({ data: { businessId: business.id, name: "All", filter: {} } });
    const campaign = await tx.campaign.create({
      data: { businessId: business.id, organizationId: org.id, name: "Outreach", segmentId: segment.id, identityId: identity.id, timezone: "UTC", sendStartHour: 9, sendEndHour: 17 },
    });
    const sequence = await tx.sequence.create({ data: { businessId: business.id, campaignId: campaign.id, name: "Seq" } });
    const s1 = await tx.sequenceStep.create({ data: { businessId: business.id, sequenceId: sequence.id, position: 1, delayDays: 0, subject: "Hello {{firstName}}", body: "Hi {{firstName}} at {{company}}." } });
    const s2 = await tx.sequenceStep.create({ data: { businessId: business.id, sequenceId: sequence.id, position: 2, delayDays: 3, subject: "Following up", body: "Just checking in." } });
    return { identityId: identity.id, segmentId: segment.id, campaignId: campaign.id, steps: [s1.id, s2.id] };
  });
  const tenant = { orgId: org.id, businessId: business.id, ...t };
  allTenants.push(tenant);
  return tenant;
}

async function addLead(tenant: Tenant, key: string, email: string | null, name = key, company = `${key} Ltd`) {
  const lead = await withBusinessScope(tenant.orgId, tenant.businessId, (tx) =>
    tx.lead.create({ data: { businessId: tenant.businessId, name, email, company } })
  );
  leadIds[`${tenant.businessId}:${key}`] = lead.id;
  return lead.id;
}

const messagesOf = (t: Tenant) =>
  withBusinessScope(t.orgId, t.businessId, (tx) =>
    tx.campaignMessage.findMany({ where: { campaignId: t.campaignId }, include: { step: true }, orderBy: { createdAt: "asc" } })
  );

beforeAll(async () => {
  process.env.EMAIL_LINK_SECRET = "test-secret-for-link-signing";
  process.env.CAMPAIGN_SANDBOX_ALLOWLIST = "owner@example.com";
  // A crashed earlier run can leave platform-wide suppressions behind; start from a clean slate.
  await db.$transaction(async (tx) => {
    await tx.suppression.deleteMany({
      where: { businessId: null, email: { in: ["ada@acme-test.example", "globalbounce@x.example", "bola@acme-test.example", "gone@c.example"] } },
    });
  });
  A = await makeTenant("a");
  B = await makeTenant("b");

  await addLead(A, "ada", "Ada@Acme-test.example", "ada obi");
  await addLead(A, "bola", "bola@acme-test.example", "BOLA ADE");
  await addLead(A, "suppressed", "suppressed@x.example");
  await addLead(A, "globalbounce", "globalbounce@x.example");
  await addLead(A, "dup", "ada@acme-test.example"); // same address as ada, different case
  await addLead(A, "noemail", null);
  await addLead(A, "invalid", "someone@nodomain.invalid");
  await addLead(B, "carl", "carl@b-test.example");

  await withBusinessScope(A.orgId, A.businessId, async (tx) => {
    await addSuppression(tx, { businessId: A.businessId, email: "suppressed@x.example", reason: "unsubscribe" });
    await addSuppression(tx, { businessId: null, email: "globalbounce@x.example", reason: "hard_bounce" });
  });
});

afterAll(async () => {
  vi.unstubAllGlobals();
  for (const t of allTenants) await purge(t);
  await db.$transaction(async (tx) => {
    await tx.suppression.deleteMany({
      where: { businessId: null, email: { in: ["ada@acme-test.example", "globalbounce@x.example", "bola@acme-test.example", "gone@c.example"] } },
    });
  });
});

describe("launching a campaign", () => {
  it("schedules one first-step email per valid, unsuppressed, de-duplicated address", async () => {
    const r = await launchCampaign(A.orgId, A.businessId, A.campaignId, deps(MONDAY_11));
    expect(r).toMatchObject({ scheduled: 2, suppressed: 2, duplicate: 1, invalid: 1 });
    const msgs = await messagesOf(A);
    expect(msgs.map((m) => m.toEmail).sort()).toEqual(["ada@acme-test.example", "bola@acme-test.example"]);
    expect(msgs.every((m) => m.status === "scheduled" && m.step.position === 1)).toBe(true);
    expect(msgs.every((m) => m.token.length >= 20)).toBe(true);
    const c = await withBusinessScope(A.orgId, A.businessId, (tx) => tx.campaign.findFirst({ where: { id: A.campaignId } }));
    expect(c?.status).toBe("active");
  });

  it("refuses to launch without an email step or a physical address", async () => {
    const t = await makeTenant("empty");
    await withBusinessScope(t.orgId, t.businessId, (tx) => tx.sequenceStep.deleteMany({ where: { businessId: t.businessId } }));
    await expect(launchCampaign(t.orgId, t.businessId, t.campaignId, deps(MONDAY_11))).rejects.toThrow(/at least one email step/);
    const t2 = await makeTenant("noaddr");
    await withBusinessScope(t2.orgId, t2.businessId, (tx) => tx.sendingIdentity.updateMany({ where: { businessId: t2.businessId }, data: { physicalAddress: "  " } }));
    await expect(launchCampaign(t2.orgId, t2.businessId, t2.campaignId, deps(MONDAY_11))).rejects.toThrow(/physical postal address/);
    for (const x of [t, t2]) {
      await withBusinessScope(x.orgId, x.businessId, async (tx) => {
        await tx.sequenceStep.deleteMany({ where: { businessId: x.businessId } });
        await tx.sequence.deleteMany({ where: { businessId: x.businessId } });
        await tx.campaign.deleteMany({ where: { businessId: x.businessId } });
        await tx.segment.deleteMany({ where: { businessId: x.businessId } });
        await tx.sendingIdentity.deleteMany({ where: { businessId: x.businessId } });
      });
      await withOrgScope(x.orgId, (tx) => tx.business.deleteMany({ where: { organizationId: x.orgId } }));
      await db.organization.delete({ where: { id: x.orgId } });
    }
  });
});

describe("unedited template prompts", () => {
  it("refuses to launch while any step still has [[double bracket]] prompt text", async () => {
    const t = await makeTenant("tmpl");
    await withBusinessScope(t.orgId, t.businessId, (tx) =>
      tx.sequenceStep.updateMany({ where: { businessId: t.businessId, position: 1 }, data: { body: "Hi {{firstName}}, [[write something specific here]]" } })
    );
    await expect(launchCampaign(t.orgId, t.businessId, t.campaignId, deps(MONDAY_11))).rejects.toThrow(/double brackets/);
    await withBusinessScope(t.orgId, t.businessId, async (tx) => {
      await tx.sequenceStep.deleteMany({ where: { businessId: t.businessId } });
      await tx.sequence.deleteMany({ where: { businessId: t.businessId } });
      await tx.campaign.deleteMany({ where: { businessId: t.businessId } });
      await tx.segment.deleteMany({ where: { businessId: t.businessId } });
      await tx.sendingIdentity.deleteMany({ where: { businessId: t.businessId } });
    });
    await withOrgScope(t.orgId, (tx) => tx.business.deleteMany({ where: { organizationId: t.orgId } }));
    await db.organization.delete({ where: { id: t.orgId } });
  });
});

describe("sending", () => {
  it("does nothing outside business hours (weekend) and sends once the window opens", async () => {
    const weekend = await processDueMessages(A.orgId, A.businessId, deps(SATURDAY));
    expect(weekend.sent).toBe(0);
    expect(sent.length).toBe(0);
  });

  it("sends in the window, with unsubscribe link, address and tracking, and schedules step 2", async () => {
    const monday = await processDueMessages(A.orgId, A.businessId, deps(new Date("2026-10-26T16:55:00Z")));
    // Anything still not due (jitter) or outside the window stays scheduled; run a later tick too.
    const next = await processDueMessages(A.orgId, A.businessId, deps(new Date("2026-10-27T11:00:00Z")));
    expect(monday.sent + next.sent).toBe(2);
    expect(sent).toHaveLength(2);
    const email = sent.find((e) => e.to === "ada@acme-test.example")!;
    expect(email.subject).toBe("Hello Ada");
    expect(email.text).toContain("1 Test Street, Lagos");
    expect(email.text).toMatch(/https:\/\/zeroid\.test\/u\//);
    expect(email.html).toContain("/t/o/");
    expect(email.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");

    const msgs = await messagesOf(A);
    expect(msgs.filter((m) => m.step.position === 1).every((m) => m.status === "sent" && m.messageId)).toBe(true);
    const step2 = msgs.filter((m) => m.step.position === 2);
    expect(step2).toHaveLength(2);
    expect(step2.every((m) => m.status === "scheduled")).toBe(true);
  });
});

describe("stopping the sequence", () => {
  it("an unsubscribe is honoured instantly: address suppressed, pending step cancelled, idempotent", async () => {
    const msgs = await messagesOf(A);
    const step1 = msgs.find((m) => m.toEmail === "bola@acme-test.example" && m.step.position === 1)!;
    const first = await unsubscribeByToken(step1.token);
    expect(first).toMatchObject({ ok: true, email: "bola@acme-test.example", scope: "business" });
    await unsubscribeByToken(step1.token); // double click / scanner

    const after = await messagesOf(A);
    expect(after.find((m) => m.toEmail === "bola@acme-test.example" && m.step.position === 2)?.status).toBe("cancelled");
    const sup = await withBusinessScope(A.orgId, A.businessId, (tx) => tx.suppression.findMany({ where: { email: "bola@acme-test.example" } }));
    expect(sup).toHaveLength(1);
    const events = await withBusinessScope(A.orgId, A.businessId, (tx) => tx.emailEvent.count({ where: { messageId: step1.id, type: "unsubscribed" } }));
    expect(events).toBe(1);

    // And the engine will never send to that address again, even if a message were scheduled.
    sent.length = 0;
    await processDueMessages(A.orgId, A.businessId, deps(new Date("2026-11-30T11:00:00Z")));
    expect(sent.some((e) => e.to === "bola@acme-test.example")).toBe(false);
  });

  it("the global opt-out writes a platform-wide suppression", async () => {
    const msgs = await messagesOf(A);
    const m = msgs.find((x) => x.toEmail === "ada@acme-test.example" && x.step.position === 1)!;
    const r = await unsubscribeByToken(m.token, "global");
    expect(r).toMatchObject({ ok: true, scope: "global" });
    const global = await withBusinessScope(B.orgId, B.businessId, (tx) => tx.suppression.findFirst({ where: { email: "ada@acme-test.example", businessId: null } }));
    expect(global?.reason).toBe("global_optout"); // visible to ANOTHER tenant, so it protects them too
  });

  it("rejects bogus tokens", async () => {
    expect(await unsubscribeByToken("nope")).toEqual({ ok: false });
    expect(await unsubscribeByToken("x".repeat(30))).toEqual({ ok: false });
  });
});

describe("replies and bounces", () => {
  async function freshCampaign(label: string, email: string) {
    const t = await makeTenant(label);
    await addLead(t, "p", email, "pat lee");
    await launchCampaign(t.orgId, t.businessId, t.campaignId, deps(MONDAY_11));
    await processDueMessages(t.orgId, t.businessId, deps(new Date("2026-10-27T11:00:00Z")));
    const msgs = await messagesOf(t);
    return { t, step1: msgs.find((m) => m.step.position === 1)!, all: msgs };
  }
  const reply = (id: string, body: string, extra = "") =>
    `From: Pat Lee <pat@c.example>\nTo: hello@x.example\nSubject: Re: Hello\nIn-Reply-To: ${id}\nReferences: ${id}\n${extra}Content-Type: text/plain\n\n${body}\n\n> quoted original\n`;

  it("an interested reply stops the sequence, moves the lead to engaged and creates a task", async () => {
    const { t, step1 } = await freshCampaign("rep1", "pat@c.example");
    const r = await handleInboundEmail(reply(step1.messageId!, "Yes, interested! Can we talk this week?"));
    expect(r).toMatchObject({ kind: "reply", cls: "interested" });
    const after = await messagesOf(t);
    expect(after.find((m) => m.step.position === 2)?.status).toBe("cancelled");
    const tasks = await withBusinessScope(t.orgId, t.businessId, (tx) => tx.task.findMany({ where: { businessId: t.businessId } }));
    expect(tasks.some((x) => /Interested reply/.test(x.title))).toBe(true);
    const lead = await withBusinessScope(t.orgId, t.businessId, (tx) => tx.lead.findFirst({ where: { businessId: t.businessId } }));
    expect(lead?.stage).toBe("engaged");
  });

  it("an out-of-office auto-reply does NOT stop the sequence or create a task", async () => {
    const { t, step1 } = await freshCampaign("rep2", "pat2@c.example");
    const r = await handleInboundEmail(reply(step1.messageId!, "I am out of office until Monday.", "Auto-Submitted: auto-replied\n"));
    expect(r).toMatchObject({ kind: "reply", cls: "out_of_office" });
    expect((await messagesOf(t)).find((m) => m.step.position === 2)?.status).toBe("scheduled");
    expect(await withBusinessScope(t.orgId, t.businessId, (tx) => tx.task.count({ where: { businessId: t.businessId } }))).toBe(0);
  });

  it("an unsubscribe reply suppresses the address; a not-now reply just stops; an ambiguous one makes a review task", async () => {
    const u = await freshCampaign("rep3", "pat3@c.example");
    expect(await handleInboundEmail(reply(u.step1.messageId!, "Please remove me from your list."))).toMatchObject({ cls: "unsubscribe" });
    expect(await withBusinessScope(u.t.orgId, u.t.businessId, (tx) => tx.suppression.count({ where: { email: "pat3@c.example" } }))).toBe(1);

    const n = await freshCampaign("rep4", "pat4@c.example");
    expect(await handleInboundEmail(reply(n.step1.messageId!, "Not right now, maybe next quarter."))).toMatchObject({ cls: "not_now" });
    expect((await messagesOf(n.t)).find((m) => m.step.position === 2)?.status).toBe("cancelled");

    const o = await freshCampaign("rep5", "pat5@c.example");
    const r = await handleInboundEmail(reply(o.step1.messageId!, "Hmm, ok."));
    expect(r.kind).toBe("reply");
    expect((r as { cls: string }).cls).toBe("other"); // no AI credits in the test org -> falls back to a human task
    expect(await withBusinessScope(o.t.orgId, o.t.businessId, (tx) => tx.task.count({ where: { title: { startsWith: "Review reply" } } }))).toBe(1);
  });

  it("a hard bounce marks the message, adds a platform-wide suppression and cancels the next step", async () => {
    const { t, step1 } = await freshCampaign("bnc1", "gone@c.example");
    const dsn =
      `From: MAILER-DAEMON@mx.example\nTo: hello@x.example\nSubject: Undelivered Mail Returned to Sender\n` +
      `Content-Type: multipart/report; report-type=delivery-status; boundary="BND"\n\n--BND\nContent-Type: text/plain\n\nDelivery failed.\n\n` +
      `--BND\nContent-Type: message/delivery-status\n\nFinal-Recipient: rfc822; gone@c.example\nStatus: 5.1.1\nDiagnostic-Code: smtp; 550 5.1.1 user unknown\n\n` +
      `--BND\nContent-Type: text/rfc822-headers\n\nMessage-ID: ${step1.messageId}\nX-Zeroid-Message: ${step1.token}\n\n--BND--\n`;
    const r = await handleInboundEmail(dsn);
    expect(r).toEqual({ kind: "bounce", hard: true });
    expect((await messagesOf(t)).find((m) => m.step.position === 1)?.status).toBe("bounced");
    expect((await messagesOf(t)).find((m) => m.step.position === 2)?.status).toBe("cancelled");
    const g = await withBusinessScope(A.orgId, A.businessId, (tx) => tx.suppression.findFirst({ where: { email: "gone@c.example", businessId: null } }));
    expect(g?.reason).toBe("hard_bounce");
    await withBusinessScope(A.orgId, A.businessId, (tx) => tx.suppression.deleteMany({ where: { email: "gone@c.example" } }));
  });

  it("a soft bounce (4.x.x) is recorded but does not suppress", async () => {
    const { step1 } = await freshCampaign("bnc2", "full@c.example");
    const dsn =
      `From: MAILER-DAEMON@mx.example\nTo: hello@x.example\nSubject: Delivery Status Notification (Delay)\n` +
      `Content-Type: multipart/report; report-type=delivery-status; boundary="BND"\n\n--BND\nContent-Type: message/delivery-status\n\nStatus: 4.2.2\n\n` +
      `--BND\nContent-Type: text/rfc822-headers\n\nX-Zeroid-Message: ${step1.token}\n\n--BND--\n`;
    expect(await handleInboundEmail(dsn)).toEqual({ kind: "bounce", hard: false });
    expect(await withBusinessScope(A.orgId, A.businessId, (tx) => tx.suppression.count({ where: { email: "full@c.example" } }))).toBe(0);
  });

  it("mail that matches no campaign message is ignored", async () => {
    expect(await handleInboundEmail("From: x@y.example\nTo: z@w.example\nSubject: hi\n\nhello\n")).toEqual({ kind: "unmatched" });
  });
});

describe("the sandbox guard holds inside the engine", () => {
  it("a campaign on the shared Brevo identity never reaches a real prospect: skipped + blocked event, no network call", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const t = await makeTenant("brevo", "brevo_shared");
    await addLead(t, "real", "ceo@real-prospect.example", "Real Person");
    await addLead(t, "owner", "owner@example.com", "Owner Self");
    await launchCampaign(t.orgId, t.businessId, t.campaignId, deps(MONDAY_11, { senders: SENDERS }));
    process.env.BREVO_API_KEY = "test-key";
    process.env.BREVO_FROM_EMAIL = "verified@sender.example";
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ messageId: "brevo-1" }), text: async () => "" });

    await processDueMessages(t.orgId, t.businessId, deps(new Date("2026-10-27T11:00:00Z"), { senders: SENDERS }));

    const msgs = await messagesOf(t);
    const real = msgs.find((m) => m.toEmail === "ceo@real-prospect.example")!;
    const owner = msgs.find((m) => m.toEmail === "owner@example.com")!;
    expect(real.status).toBe("skipped");
    expect(real.error).toMatch(/allow-list/);
    expect(owner.status).toBe("sent");
    // Exactly ONE network call happened in total, and it was to the allow-listed owner address.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.to).toEqual([{ email: "owner@example.com" }]);
    expect(body.subject).toMatch(/^\[Zeroid sandbox\]/);
    const blocked = await withBusinessScope(t.orgId, t.businessId, (tx) => tx.emailEvent.count({ where: { messageId: real.id, type: "blocked" } }));
    expect(blocked).toBe(1);
    vi.unstubAllGlobals();
    delete process.env.BREVO_API_KEY;
    delete process.env.BREVO_FROM_EMAIL;

    await withBusinessScope(t.orgId, t.businessId, async (tx) => {
      await tx.emailEvent.deleteMany({ where: { businessId: t.businessId } });
      await tx.campaignMessage.deleteMany({ where: { businessId: t.businessId } });
      await tx.sequenceStep.deleteMany({ where: { businessId: t.businessId } });
      await tx.sequence.deleteMany({ where: { businessId: t.businessId } });
      await tx.campaign.deleteMany({ where: { businessId: t.businessId } });
      await tx.segment.deleteMany({ where: { businessId: t.businessId } });
      await tx.sendingIdentity.deleteMany({ where: { businessId: t.businessId } });
      await tx.leadEvent.deleteMany({ where: { businessId: t.businessId } });
      await tx.lead.deleteMany({ where: { businessId: t.businessId } });
    });
    await withOrgScope(t.orgId, (tx) => tx.business.deleteMany({ where: { organizationId: t.orgId } }));
    await db.organization.delete({ where: { id: t.orgId } });
  });

  it("calling the real Brevo sender directly with a real prospect throws and makes no request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      SENDERS.brevo_shared.send(
        { provider: "brevo_shared", sandboxOnly: false, fromEmail: "a@b.example", fromName: "X" },
        { to: "ceo@real-prospect.example", subject: "s", text: "t", html: "h", headers: {}, replyTo: "a@b.example", messageId: "<x@y>" }
      )
    ).rejects.toBeInstanceOf(SandboxBlockedError);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe("caps and pausing", () => {
  it("never sends more than the identity daily cap in one day", async () => {
    const t = await makeTenant("cap");
    for (let i = 0; i < 5; i++) await addLead(t, `l${i}`, `cap${i}@cap-test.example`);
    await withBusinessScope(t.orgId, t.businessId, (tx) => tx.sendingIdentity.updateMany({ where: { businessId: t.businessId }, data: { dailyCap: 2 } }));
    await launchCampaign(t.orgId, t.businessId, t.campaignId, deps(MONDAY_11));
    sent.length = 0;
    const r = await processDueMessages(t.orgId, t.businessId, deps(new Date("2026-10-27T11:00:00Z")));
    expect(r.sent).toBe(2);
    const again = await processDueMessages(t.orgId, t.businessId, deps(new Date("2026-10-27T12:00:00Z")));
    expect(again.sent).toBe(0);
    await withBusinessScope(t.orgId, t.businessId, async (tx) => {
      await tx.emailEvent.deleteMany({ where: { businessId: t.businessId } });
      await tx.campaignMessage.deleteMany({ where: { businessId: t.businessId } });
      await tx.sequenceStep.deleteMany({ where: { businessId: t.businessId } });
      await tx.sequence.deleteMany({ where: { businessId: t.businessId } });
      await tx.campaign.deleteMany({ where: { businessId: t.businessId } });
      await tx.segment.deleteMany({ where: { businessId: t.businessId } });
      await tx.sendingIdentity.deleteMany({ where: { businessId: t.businessId } });
      await tx.leadEvent.deleteMany({ where: { businessId: t.businessId } });
      await tx.lead.deleteMany({ where: { businessId: t.businessId } });
    });
    await withOrgScope(t.orgId, (tx) => tx.business.deleteMany({ where: { organizationId: t.orgId } }));
    await db.organization.delete({ where: { id: t.orgId } });
  });

  it("a paused campaign sends nothing", async () => {
    await withBusinessScope(B.orgId, B.businessId, (tx) => tx.campaign.update({ where: { id: B.campaignId }, data: { status: "draft" } }));
    await launchCampaign(B.orgId, B.businessId, B.campaignId, deps(MONDAY_11));
    await pauseCampaign(B.orgId, B.businessId, B.campaignId);
    sent.length = 0;
    const r = await processDueMessages(B.orgId, B.businessId, deps(new Date("2026-10-27T11:00:00Z")));
    expect(r.sent).toBe(0);
    expect(sent).toHaveLength(0);
  });
});

describe("tenant isolation (RLS) on the new tables", () => {
  it("tenant A cannot read tenant B campaigns, identities, messages, events or steps", async () => {
    const view = await withBusinessScope(A.orgId, A.businessId, async (tx) => ({
      campaigns: await tx.campaign.findMany(),
      identities: await tx.sendingIdentity.findMany(),
      segments: await tx.segment.findMany(),
      messages: await tx.campaignMessage.findMany(),
      events: await tx.emailEvent.findMany(),
      steps: await tx.sequenceStep.findMany(),
      bCampaign: await tx.campaign.findFirst({ where: { id: B.campaignId } }),
    }));
    expect(view.bCampaign).toBeNull();
    for (const rows of [view.campaigns, view.identities, view.segments, view.messages, view.events, view.steps]) {
      expect(rows.every((r) => (r as { businessId: string }).businessId === A.businessId)).toBe(true);
    }
  });

  it("a query with NO tenant scope returns nothing and cannot write", async () => {
    expect(await db.campaign.findMany()).toEqual([]);
    expect(await db.campaignMessage.findMany()).toEqual([]);
    expect(await db.emailEvent.findMany()).toEqual([]);
    await expect(
      db.sendingIdentity.create({ data: { businessId: A.businessId, name: "x", fromEmail: "x@y.example", fromName: "x", physicalAddress: "x" } })
    ).rejects.toThrow();
  });

  it("a message token opens exactly one message; a wrong token opens nothing", async () => {
    const aMsg = (await messagesOf(A))[0];
    const hit = await withMessageLookupScope({ token: aMsg.token }, (tx) => tx.campaignMessage.findMany());
    expect(hit.map((m) => m.id)).toEqual([aMsg.id]);
    expect(await withMessageLookupScope({ token: "not-a-real-token" }, (tx) => tx.campaignMessage.findMany())).toEqual([]);
  });

  it("suppressions: a business sees platform-wide ones and its own, never another business own", async () => {
    await withBusinessScope(B.orgId, B.businessId, (tx) => addSuppression(tx, { businessId: B.businessId, email: "only-b@z.example", reason: "manual" }));
    const aView = await withBusinessScope(A.orgId, A.businessId, (tx) => tx.suppression.findMany());
    expect(aView.some((s) => s.email === "only-b@z.example")).toBe(false);
    expect(aView.some((s) => s.email === "globalbounce@x.example" && s.businessId === null)).toBe(true);
    await withBusinessScope(B.orgId, B.businessId, (tx) => tx.suppression.deleteMany({ where: { email: "only-b@z.example" } }));
  });
});
