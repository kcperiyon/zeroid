// Discovery against the real database: job planning, the cell queue, de-duplication, enrichment
// storage, the import safeguard (guesses never reach a lead), and tenant isolation (RLS).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../src/lib/db";
import { withBusinessScope, withOrgScope } from "../src/lib/tenant-db";
import { createJob, planJobs, runCells, runEnrichment, setJobStatus, type RunnerDeps } from "../src/lib/discovery/runner";
import { importProspectAsLead } from "../src/lib/prospect-import";
import { PoliteCrawler } from "../src/lib/discovery/web";

const tag = Date.now();
type Tenant = { orgId: string; businessId: string };
const tenants: Tenant[] = [];

async function makeTenant(label: string): Promise<Tenant> {
  const org = await db.organization.create({ data: { name: `Disc ${label}`, slug: `disc-${label}-${tag}` } });
  const business = await withOrgScope(org.id, (tx) => tx.business.create({ data: { organizationId: org.id, name: `Biz ${label}` } }));
  const t = { orgId: org.id, businessId: business.id };
  tenants.push(t);
  return t;
}

async function purge(t: Tenant) {
  await withBusinessScope(t.orgId, t.businessId, async (tx) => {
    await tx.prospectEmail.deleteMany({ where: { businessId: t.businessId } });
    await tx.prospect.deleteMany({ where: { businessId: t.businessId } });
    await tx.discoveryCell.deleteMany({ where: { businessId: t.businessId } });
    await tx.discoveryJob.deleteMany({ where: { businessId: t.businessId } });
    await tx.leadEvent.deleteMany({ where: { businessId: t.businessId } });
    await tx.lead.deleteMany({ where: { businessId: t.businessId } });
    await tx.leadSource.deleteMany({ where: { businessId: t.businessId } });
  });
  await withOrgScope(t.orgId, (tx) => tx.business.deleteMany({ where: { organizationId: t.orgId } }));
  await db.organization.deleteMany({ where: { id: t.orgId } });
}

// ---- fake network --------------------------------------------------------------------------------------------------

let overpass: (n: number) => Response = () => json({ elements: [] });
let overpassCalls = 0;
let geocodeBox: string[] | null = ["6.30", "6.50", "3.20", "3.40"]; // south, north, west, east: a 2x2 grid of 0.1-degree cells
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

const fakeFetch: RunnerDeps["fetch"] = async (url) => {
  if (url.includes("nominatim")) return json(geocodeBox ? [{ display_name: "Lagos, Nigeria", boundingbox: geocodeBox }] : []);
  if (url.includes("overpass")) return overpass(++overpassCalls);
  throw new Error(`unexpected fetch ${url}`);
};
const noSleep = async () => {};
const base: RunnerDeps = { fetch: fakeFetch, sleepFn: noSleep, overpassGapMs: 0 };

const el = (id: number, tags: Record<string, string>) => ({ type: "node", id, lat: 6.35, lon: 3.25, tags });

let A: Tenant;
let B: Tenant;
beforeAll(async () => {
  A = await makeTenant("a");
  B = await makeTenant("b");
});
afterAll(async () => {
  for (const t of tenants) await purge(t);
  await db.$disconnect();
});

const jobCfg = (over: Record<string, unknown> = {}) => ({
  name: "Test job", industries: ["accountants"], locations: ["Lagos, Nigeria"], sources: ["osm"] as ("osm" | "places")[],
  maxProspects: 100, maxCells: 50, autoEnrich: true, ...over,
});
const getJob = (t: Tenant, id: string) => withBusinessScope(t.orgId, t.businessId, (tx) => tx.discoveryJob.findUniqueOrThrow({ where: { id } }));
const cellsOf = (t: Tenant, jobId: string) => withBusinessScope(t.orgId, t.businessId, (tx) => tx.discoveryCell.findMany({ where: { jobId } }));
const prospects = (t: Tenant) => withBusinessScope(t.orgId, t.businessId, (tx) => tx.prospect.findMany({ where: { businessId: t.businessId }, orderBy: { createdAt: "asc" } }));

describe("planning", () => {
  it("geocodes each location and cuts it into one cell per grid square per industry and source", async () => {
    const job = await createJob(A.orgId, A.businessId, jobCfg({ industries: ["accountants", "lawyers"] }));
    expect(job.status).toBe("planning");
    await planJobs(A.orgId, A.businessId, base);
    const planned = await getJob(A, job.id);
    expect(planned.status).toBe("running");
    expect(planned.cellsTotal).toBe(8); // 4 grid squares x 2 industries x 1 source
    expect((await cellsOf(A, job.id)).every((c) => c.status === "pending" && c.south < c.north)).toBe(true);
    await setJobStatus(A.orgId, A.businessId, job.id, "cancel");
  });
  it("fails the job with a plain message for an unknown place, an oversized area, or too many searches", async () => {
    geocodeBox = null;
    const j1 = await createJob(A.orgId, A.businessId, jobCfg());
    await planJobs(A.orgId, A.businessId, base);
    expect(await getJob(A, j1.id)).toMatchObject({ status: "failed" });
    expect((await getJob(A, j1.id)).lastError).toMatch(/not found on the map/);

    geocodeBox = ["0", "10", "0", "10"];
    const j2 = await createJob(A.orgId, A.businessId, jobCfg({ locations: ["Nigeria"] }));
    await planJobs(A.orgId, A.businessId, base);
    expect((await getJob(A, j2.id)).lastError).toMatch(/too large an area/);

    geocodeBox = ["6.30", "6.50", "3.20", "3.40"];
    const j3 = await createJob(A.orgId, A.businessId, jobCfg({ maxCells: 3 }));
    await planJobs(A.orgId, A.businessId, base);
    expect((await getJob(A, j3.id)).lastError).toMatch(/above the limit of 3/);
    const j4 = await createJob(A.orgId, A.businessId, jobCfg({ industries: ["osm:bad=va;lue"] }));
    await planJobs(A.orgId, A.businessId, base);
    expect((await getJob(A, j4.id)).lastError).toMatch(/no valid industries/);
  });
});

describe("running cells and de-duplication", () => {
  it("stores candidates, merges duplicates by domain / phone / source id, and finishes the job", async () => {
    const t = await makeTenant("dedupe");
    overpassCalls = 0;
    // Every cell returns the same two businesses plus one unique one, so cells overlap like real grid edges do.
    overpass = (n) =>
      json({
        elements: [
          el(1, { name: "Okafor & Co", website: "https://www.okafor.test", phone: "+234 707 296 3805" }),
          el(2, { name: "Okafor Accountants Lagos", website: "https://okafor.test/contact", phone: "+234 1 999 0000" }), // same domain as #1
          el(3, { name: "Bello Tax", phone: "0707 296 3805" }), // same phone as #1 (last 9 digits)
          el(100 + n, { name: `Unique ${n}`, website: `https://unique${n}.test` }),
        ],
      });
    const job = await createJob(t.orgId, t.businessId, jobCfg());
    await planJobs(t.orgId, t.businessId, base);
    await runCells(t.orgId, t.businessId, 30_000, base);
    const done = await getJob(t, job.id);
    expect(done.status).toBe("done");
    expect(done.cellsDone).toBe(4);
    const list = await prospects(t);
    // 1 (Okafor) + 4 unique; #2 and #3 collapse into #1 on every cell, and #1 itself on cells 2-4.
    expect(list).toHaveLength(5);
    expect(done.found).toBe(5);
    expect(done.duplicates).toBe(11); // 2 in the first cell (same site, same phone) + 3 in each of the other three
    const okafor = list.find((p) => p.name === "Okafor & Co")!;
    expect(okafor.domain).toBe("okafor.test");
    expect(okafor.enrichStatus).toBe("pending");
    expect((okafor.signals as { sources?: unknown[] }).sources?.length).toBeGreaterThan(0);
    expect(list.filter((p) => p.domain === "okafor.test")).toHaveLength(1);
    await purge(t);
    tenants.splice(tenants.indexOf(t), 1);
  });
  it("never creates two prospects for one domain in one business, even if inserted concurrently", async () => {
    const t = await makeTenant("race");
    const one = (id: number) =>
      withBusinessScope(t.orgId, t.businessId, (tx) =>
        tx.prospect.create({ data: { businessId: t.businessId, channel: "osm", externalId: `node/${id}`, name: `Dup ${id}`, domain: "same.test" } }).then(() => "ok", () => "refused")
      );
    const results = await Promise.all([one(1), one(2), one(3)]);
    expect(results.filter((r) => r === "ok")).toHaveLength(1);
  });
  it("retries a busy Overpass, then gives up after three attempts without losing the job", async () => {
    const t = await makeTenant("busy");
    overpass = () => new Response("busy", { status: 429 });
    const job = await createJob(t.orgId, t.businessId, jobCfg());
    geocodeBox = ["6.30", "6.40", "3.20", "3.30"]; // one cell
    await planJobs(t.orgId, t.businessId, base);
    await runCells(t.orgId, t.businessId, 30_000, base);
    const cell = (await cellsOf(t, job.id))[0];
    expect(cell).toMatchObject({ status: "failed", attempts: 3 });
    expect(cell.error).toMatch(/busy/i);
    const done = await getJob(t, job.id);
    expect(done.status).toBe("done");
    expect(done.lastError).toMatch(/busy/i);
    geocodeBox = ["6.30", "6.50", "3.20", "3.40"];
  });
  it("stops at the prospect cap and cancels the cells it did not need", async () => {
    const t = await makeTenant("cap");
    overpass = (n) => json({ elements: [1, 2, 3, 4].map((i) => el(n * 10 + i, { name: `Cap ${n}-${i}`, website: `https://cap${n}x${i}.test` })) });
    const job = await createJob(t.orgId, t.businessId, jobCfg({ maxProspects: 6 }));
    await planJobs(t.orgId, t.businessId, base);
    await runCells(t.orgId, t.businessId, 30_000, base);
    const done = await getJob(t, job.id);
    expect(done.found).toBe(6);
    expect(done.status).toBe("done");
    expect(done.lastError).toMatch(/limit of 6/);
    expect((await cellsOf(t, job.id)).filter((c) => c.status === "cancelled").length).toBeGreaterThan(0);
    expect(await prospects(t)).toHaveLength(6);
  });
  it("does not run a paused or cancelled job, and resumes a paused one", async () => {
    const t = await makeTenant("pause");
    overpassCalls = 0;
    overpass = (n) => json({ elements: [el(n, { name: `P${n}`, website: `https://p${n}.test` })] });
    const job = await createJob(t.orgId, t.businessId, jobCfg());
    await planJobs(t.orgId, t.businessId, base);
    await setJobStatus(t.orgId, t.businessId, job.id, "pause");
    expect(await runCells(t.orgId, t.businessId, 5_000, base)).toBe(0);
    expect(overpassCalls).toBe(0);
    await setJobStatus(t.orgId, t.businessId, job.id, "resume");
    expect(await runCells(t.orgId, t.businessId, 30_000, base)).toBe(4);
    const j2 = await createJob(t.orgId, t.businessId, jobCfg());
    await planJobs(t.orgId, t.businessId, base);
    await setJobStatus(t.orgId, t.businessId, j2.id, "cancel");
    overpassCalls = 0;
    expect(await runCells(t.orgId, t.businessId, 5_000, base)).toBe(0);
    expect(overpassCalls).toBe(0);
  });
  it("reclaims a cell left 'running' by a crashed worker, and two workers never take the same cell", async () => {
    const t = await makeTenant("claim");
    overpassCalls = 0;
    overpass = (n) => json({ elements: [el(n, { name: `C${n}`, website: `https://c${n}.test` })] });
    const job = await createJob(t.orgId, t.businessId, jobCfg());
    await planJobs(t.orgId, t.businessId, base);
    const [first] = await cellsOf(t, job.id);
    await withBusinessScope(t.orgId, t.businessId, (tx) => tx.discoveryCell.update({ where: { id: first.id }, data: { status: "running", startedAt: new Date(Date.now() - 3_600_000) } }));
    await Promise.all([runCells(t.orgId, t.businessId, 30_000, base), runCells(t.orgId, t.businessId, 30_000, base)]);
    const cells = await cellsOf(t, job.id);
    expect(cells.every((c) => c.status === "done")).toBe(true);
    expect(cells.every((c) => c.attempts === 1)).toBe(true);
    expect(overpassCalls).toBe(4);
  });
  it("marks a company that is already a lead, and does not queue it for enrichment", async () => {
    const t = await makeTenant("haslead");
    await withBusinessScope(t.orgId, t.businessId, (tx) => tx.lead.create({ data: { businessId: t.businessId, name: "Existing", email: "boss@known.test" } }));
    geocodeBox = ["6.30", "6.40", "3.20", "3.30"];
    overpass = () => json({ elements: [el(1, { name: "Known Ltd", website: "https://known.test" }), el(2, { name: "Fresh Ltd", website: "https://fresh.test" })] });
    await createJob(t.orgId, t.businessId, jobCfg());
    await planJobs(t.orgId, t.businessId, base);
    await runCells(t.orgId, t.businessId, 30_000, base);
    const list = await prospects(t);
    expect(list.find((p) => p.name === "Known Ltd")).toMatchObject({ enrichStatus: "skipped" });
    expect((list.find((p) => p.name === "Known Ltd")!.signals as { existingLeadId?: string }).existingLeadId).toBeTruthy();
    expect(list.find((p) => p.name === "Fresh Ltd")!.enrichStatus).toBe("pending");
    geocodeBox = ["6.30", "6.50", "3.20", "3.40"];
  });
});

describe("enrichment storage and the import safeguard", () => {
  const pages: Record<string, string> = {
    "https://acme.test/robots.txt": "",
    "https://acme.test/": `<html><head><title>Acme</title><meta name="description" content="Freight."></head><body>
      <a href="mailto:ada.okafor@acme.test">Ada</a><p>Ada Okafor, Managing Director</p><p>Chidi Eze, Head of Operations</p></body></html>`,
  };
  const crawler = () =>
    new PoliteCrawler({
      minDelayMs: 0,
      fetchPage: (async (url: string) => {
        if (!(url in pages)) throw new Error("unreachable");
        return { status: url.endsWith("robots.txt") ? 404 : 200, contentType: "text/html", body: pages[url], finalUrl: url };
      }) as never,
    });
  const enrichDeps = () => ({ crawler: crawler(), mxCheck: async () => true, probeEnabled: false });

  async function seed(t: Tenant, name: string, website: string | null, email: string | null = null) {
    return withBusinessScope(t.orgId, t.businessId, (tx) =>
      tx.prospect.create({
        data: { businessId: t.businessId, channel: "osm", externalId: `node/${name}`, name, website, email, domain: website ? new URL(website).hostname : null, country: "Nigeria", enrichStatus: "pending" },
      })
    );
  }

  it("stores scored addresses, signals and a research note; only a confident address becomes the prospect's email", async () => {
    const t = await makeTenant("enrich");
    const p = await seed(t, "Acme Freight", "https://acme.test/");
    expect(await runEnrichment(t.orgId, t.businessId, 20_000, { enrichDeps: enrichDeps() })).toBe(1);
    const row = await withBusinessScope(t.orgId, t.businessId, (tx) => tx.prospect.findUniqueOrThrow({ where: { id: p.id }, include: { emails: { orderBy: { confidence: "desc" } } } }));
    expect(row.enrichStatus).toBe("done");
    expect(row.email).toBe("ada.okafor@acme.test");
    expect(row.bestEmailConfidence).toBeGreaterThanOrEqual(60);
    expect(row.researchNote).toContain("Acme Freight");
    expect(row.researchNote).toContain("Ada Okafor (Managing Director)");
    const guess = row.emails.find((e) => e.kind === "pattern_guess");
    expect(guess?.email).toBe("chidi.eze@acme.test");
    expect(guess!.confidence).toBeLessThan(60);
    expect((row.signals as { people?: unknown[] }).people?.length).toBe(2);
  });

  it("imports a lead with only a confident address, carries confidence, note and country, and never copies a guess", async () => {
    const t = await makeTenant("import");
    const p = await seed(t, "Acme Freight", "https://acme.test/");
    await runEnrichment(t.orgId, t.businessId, 20_000, { enrichDeps: enrichDeps() });
    const lead = await withBusinessScope(t.orgId, t.businessId, async (tx) => {
      await importProspectAsLead(tx, t.businessId, p.id);
      return tx.lead.findFirstOrThrow({ where: { businessId: t.businessId } });
    });
    expect(lead.email).toBe("ada.okafor@acme.test");
    expect(lead.emailConfidence).toBeGreaterThanOrEqual(60);
    expect(lead.researchNote).toContain("Acme Freight");
    expect((lead.contact as { country?: string; domain?: string }).country).toBe("Nigeria");

    // A site that publishes no address: the only candidates are guesses, so the lead gets no email at all.
    const t2 = await makeTenant("import2");
    pages["https://noaddr.test/robots.txt"] = "";
    pages["https://noaddr.test/"] = `<html><body><p>Ada Okafor, Managing Director</p></body></html>`;
    const q = await seed(t2, "No Address Co", "https://noaddr.test/");
    await withBusinessScope(t2.orgId, t2.businessId, (tx) =>
      tx.prospectEmail.create({ data: { businessId: t2.businessId, prospectId: q.id, email: "ada.okafor@noaddr.test", kind: "pattern_guess", source: "pattern:first.last", confidence: 55 } })
    );
    const lead2 = await withBusinessScope(t2.orgId, t2.businessId, async (tx) => {
      await importProspectAsLead(tx, t2.businessId, q.id);
      return tx.lead.findFirstOrThrow({ where: { businessId: t2.businessId } });
    });
    expect(lead2.email).toBeNull();
    expect(lead2.emailConfidence).toBeNull();
  });

  it("respects a stricter per-business threshold", async () => {
    const t = await makeTenant("strict");
    await withBusinessScope(t.orgId, t.businessId, (tx) => tx.business.update({ where: { id: t.businessId }, data: { settings: { minEmailConfidence: 95 } } }));
    const p = await seed(t, "Acme Freight", "https://acme.test/");
    await runEnrichment(t.orgId, t.businessId, 20_000, { enrichDeps: enrichDeps() });
    const row = await withBusinessScope(t.orgId, t.businessId, (tx) => tx.prospect.findUniqueOrThrow({ where: { id: p.id } }));
    expect(row.email).toBeNull(); // 90-ish is below 95
    expect(row.bestEmailConfidence).toBeGreaterThan(60);
  });

  it("records an unreachable site as failed and a robots block as skipped, with the reason", async () => {
    const t = await makeTenant("fail");
    const bad = await seed(t, "Down Co", "https://down.test/");
    const blocked = await seed(t, "Blocked Co", "https://blocked.test/");
    pages["https://blocked.test/robots.txt"] = "User-agent: *\nDisallow: /\n";
    const deps = { crawler: new PoliteCrawler({ minDelayMs: 0, fetchPage: (async (url: string) => {
      if (url.startsWith("https://blocked.test")) return { status: 200, contentType: "text/plain", body: pages["https://blocked.test/robots.txt"], finalUrl: url };
      throw new Error("ECONNREFUSED");
    }) as never }), mxCheck: async () => true, probeEnabled: false };
    await runEnrichment(t.orgId, t.businessId, 20_000, { enrichDeps: deps });
    const rows = await prospects(t);
    expect(rows.find((r) => r.id === bad.id)).toMatchObject({ enrichStatus: "failed" });
    expect(rows.find((r) => r.id === blocked.id)).toMatchObject({ enrichStatus: "skipped" });
    expect(rows.find((r) => r.id === blocked.id)!.enrichError).toMatch(/robots/i);
  });
});

describe("tenant isolation (RLS)", () => {
  it("hides one business's jobs, cells, prospects and addresses from another, and from an unscoped connection", async () => {
    overpass = () => json({ elements: [el(7, { name: "Secret Co", website: "https://secret.test" })] });
    geocodeBox = ["6.30", "6.40", "3.20", "3.30"];
    await createJob(A.orgId, A.businessId, jobCfg());
    await planJobs(A.orgId, A.businessId, base);
    await runCells(A.orgId, A.businessId, 20_000, base);
    const p = (await prospects(A))[0];
    await withBusinessScope(A.orgId, A.businessId, (tx) => tx.prospectEmail.create({ data: { businessId: A.businessId, prospectId: p.id, email: "x@secret.test", kind: "found", source: "t", confidence: 70 } }));

    const seenByB = await withBusinessScope(B.orgId, B.businessId, async (tx) => ({
      jobs: await tx.discoveryJob.count(), cells: await tx.discoveryCell.count(), prospects: await tx.prospect.count(), emails: await tx.prospectEmail.count(),
    }));
    expect(seenByB).toEqual({ jobs: 0, cells: 0, prospects: 0, emails: 0 });
    const unscoped = await db.$transaction(async (tx) => ({ jobs: await tx.discoveryJob.count(), emails: await tx.prospectEmail.count() }));
    expect(unscoped).toEqual({ jobs: 0, emails: 0 });
    // B cannot write rows into A either.
    await expect(
      withBusinessScope(B.orgId, B.businessId, (tx) => tx.discoveryJob.create({ data: { businessId: A.businessId, organizationId: A.orgId, name: "x" } }))
    ).rejects.toThrow();
    geocodeBox = ["6.30", "6.50", "3.20", "3.40"];
  });
});
