import { withBusinessScope } from "@/lib/tenant-db";
import { geocode, RateLimited, searchOverpass, type Candidate, type FetchLike } from "./osm";
import { isGooglePlacesConfigured, searchPlaces } from "@/lib/prospecting/google-places";
import { resolveIndustry } from "./industries";
import { countryFromAddress, gridCells } from "./normalize";
import { applyEnrichment, upsertCandidates } from "./store";
import { enrichProspect, type EnrichInput, type EnrichDeps } from "./enrich";
import { PoliteCrawler } from "./web";

/**
 * Background work for discovery. Everything here is resumable: the queue is the database (cells and
 * prospects carry their own status), claims use FOR UPDATE SKIP LOCKED, and rows stuck in "running"
 * after a crash are reclaimed. Public free services are used gently: Nominatim at most one call a
 * second, Overpass one query every few seconds with growing back-off when it says it is busy.
 */
export const SOURCES = ["osm", "places"] as const;
export type Source = (typeof SOURCES)[number];

const OVERPASS_GAP_MS = Number(process.env.OVERPASS_GAP_MS ?? 6000);
const NOMINATIM_GAP_MS = 1100;
const STALE_CELL_MS = 10 * 60_000;
const STALE_ENRICH_MS = 15 * 60_000;
const MAX_ATTEMPTS = 3;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let lastOverpassAt = 0;
let overpassBackoffUntil = 0;
let lastNominatimAt = 0;

export type JobConfig = {
  name: string;
  industries: string[];
  locations: string[];
  sources: Source[];
  maxProspects: number;
  maxCells: number;
  autoEnrich: boolean;
};

export type RunnerDeps = {
  fetch?: FetchLike;
  searchPlacesFn?: typeof searchPlaces;
  placesConfigured?: () => boolean;
  sleepFn?: (ms: number) => Promise<void>;
  enrichDeps?: EnrichDeps;
  /** Tests set 0 so cells run back to back. */
  overpassGapMs?: number;
};

// ---- creating and controlling jobs ---------------------------------------------------------------------

export async function createJob(organizationId: string, businessId: string, cfg: JobConfig) {
  return withBusinessScope(organizationId, businessId, (tx) =>
    tx.discoveryJob.create({
      data: {
        businessId, organizationId, name: cfg.name, status: "planning",
        industries: cfg.industries, locations: cfg.locations, sources: cfg.sources,
        maxProspects: cfg.maxProspects, maxCells: cfg.maxCells, autoEnrich: cfg.autoEnrich,
      },
    })
  );
}

export async function setJobStatus(organizationId: string, businessId: string, jobId: string, action: "pause" | "resume" | "cancel") {
  return withBusinessScope(organizationId, businessId, async (tx) => {
    const job = await tx.discoveryJob.findFirst({ where: { id: jobId, businessId } });
    if (!job) return null;
    if (action === "pause" && ["running", "planning"].includes(job.status)) return tx.discoveryJob.update({ where: { id: jobId }, data: { status: "paused" } });
    if (action === "resume" && job.status === "paused") return tx.discoveryJob.update({ where: { id: jobId }, data: { status: job.cellsTotal ? "running" : "planning" } });
    if (action === "cancel" && !["done", "cancelled", "failed"].includes(job.status)) {
      await tx.discoveryCell.updateMany({ where: { jobId, status: { in: ["pending", "running"] } }, data: { status: "cancelled" } });
      return tx.discoveryJob.update({ where: { id: jobId }, data: { status: "cancelled", finishedAt: new Date() } });
    }
    return job;
  });
}

// ---- planning: geocode locations, cut grid cells ----------------------------------------------------------------

export async function planJobs(organizationId: string, businessId: string, deps: RunnerDeps = {}): Promise<number> {
  const jobs = await withBusinessScope(organizationId, businessId, (tx) => tx.discoveryJob.findMany({ where: { businessId, status: "planning" }, take: 2 }));
  const wait = deps.sleepFn ?? sleep;
  for (const job of jobs) {
    const fail = (msg: string) =>
      withBusinessScope(organizationId, businessId, (tx) => tx.discoveryJob.update({ where: { id: job.id }, data: { status: "failed", lastError: msg, finishedAt: new Date() } }));
    const industries = (job.industries as string[]).map(resolveIndustry).filter((i): i is NonNullable<typeof i> => Boolean(i));
    const sources = (job.sources as string[]).filter((s): s is Source => (SOURCES as readonly string[]).includes(s));
    if (!industries.length || !sources.length) {
      await fail("The job has no valid industries or sources.");
      continue;
    }
    const perLocation: { label: string; cells: ReturnType<typeof gridCells>; box: { south: number; west: number; north: number; east: number } }[] = [];
    let problem: string | null = null;
    for (const loc of job.locations as string[]) {
      const gap = Date.now() - lastNominatimAt;
      if (gap < NOMINATIM_GAP_MS) await wait(NOMINATIM_GAP_MS - gap);
      lastNominatimAt = Date.now();
      let g;
      try {
        g = await geocode(loc, deps.fetch);
      } catch (e) {
        problem = `Could not look up "${loc}": ${(e as Error).message}`;
        break;
      }
      if (!g) {
        problem = `"${loc}" was not found on the map. Try a city or district name with its country.`;
        break;
      }
      const cells = gridCells(g.box, 0.1, 100);
      if (!cells) {
        problem = `"${loc}" covers too large an area for one search. List its main cities or districts instead.`;
        break;
      }
      perLocation.push({ label: loc, cells, box: g.box });
    }
    if (problem) {
      await fail(problem);
      continue;
    }

    const rows: { businessId: string; jobId: string; industry: string; locationLabel: string; source: string; south: number; west: number; north: number; east: number }[] = [];
    for (const loc of perLocation) {
      for (const industry of industries) {
        for (const source of sources) {
          // Places is a text search (20 results at most), so one cell per place; OSM works cell by cell.
          const boxes = source === "places" ? [loc.box] : loc.cells!;
          for (const b of boxes) rows.push({ businessId, jobId: job.id, industry: industry.key, locationLabel: loc.label, source, ...b });
        }
      }
    }
    if (rows.length > job.maxCells) {
      await fail(`This would take ${rows.length} searches, above the limit of ${job.maxCells}. Use fewer industries or locations, or smaller areas.`);
      continue;
    }
    await withBusinessScope(organizationId, businessId, async (tx) => {
      await tx.discoveryCell.createMany({ data: rows });
      await tx.discoveryJob.update({ where: { id: job.id }, data: { status: "running", cellsTotal: rows.length, startedAt: new Date() } });
    });
  }
  return jobs.length;
}

// ---- running cells ------------------------------------------------------------------------------------------------

type Cell = { id: string; jobId: string; industry: string; locationLabel: string; source: string; south: number; west: number; north: number; east: number; attempts: number };

async function claimCell(organizationId: string, businessId: string, now: Date): Promise<Cell | null> {
  return withBusinessScope(organizationId, businessId, async (tx) => {
    const stale = new Date(now.getTime() - STALE_CELL_MS);
    await tx.discoveryCell.updateMany({ where: { status: "running", startedAt: { lt: stale } }, data: { status: "pending" } });
    const rows = await tx.$queryRaw<Cell[]>`
      SELECT c.id, c."jobId", c.industry, c."locationLabel", c.source, c.south, c.west, c.north, c.east, c.attempts
      FROM "DiscoveryCell" c JOIN "DiscoveryJob" j ON j.id = c."jobId"
      WHERE c.status = 'pending' AND j.status = 'running' AND c."businessId" = ${businessId}
      ORDER BY c."createdAt" ASC, c.id ASC
      LIMIT 1 FOR UPDATE OF c SKIP LOCKED`;
    const cell = rows[0];
    if (!cell) return null;
    await tx.discoveryCell.update({ where: { id: cell.id }, data: { status: "running", startedAt: now, attempts: { increment: 1 } } });
    return cell;
  });
}

async function search(cell: Cell, deps: RunnerDeps): Promise<Candidate[]> {
  const industry = resolveIndustry(cell.industry);
  if (!industry) throw new Error(`Unknown industry "${cell.industry}".`);
  const wait = deps.sleepFn ?? sleep;
  if (cell.source === "osm") {
    const gapMs = deps.overpassGapMs ?? OVERPASS_GAP_MS;
    const until = Math.max(lastOverpassAt + gapMs, overpassBackoffUntil);
    if (Date.now() < until) await wait(until - Date.now());
    lastOverpassAt = Date.now();
    return searchOverpass(industry, { south: cell.south, west: cell.west, north: cell.north, east: cell.east }, deps.fetch);
  }
  if (cell.source === "places") {
    if (!(deps.placesConfigured ?? isGooglePlacesConfigured)()) throw new Error("Google Places is not configured for this server.");
    const found = await (deps.searchPlacesFn ?? searchPlaces)(`${industry.query} in ${cell.locationLabel}`);
    return found.map((p) => ({
      channel: "google" as const, externalId: p.externalId, name: p.name, address: p.address, phone: p.phone, email: null,
      website: p.website, category: industry.label, lat: null, lon: null, country: countryFromAddress(p.address),
    }));
  }
  throw new Error(`Unknown source "${cell.source}".`);
}

/** Works through pending cells for one business until the time budget is spent. Returns how many cells finished. */
export async function runCells(organizationId: string, businessId: string, budgetMs: number, deps: RunnerDeps = {}): Promise<number> {
  const started = Date.now();
  let done = 0;
  while (Date.now() - started < budgetMs) {
    const cell = await claimCell(organizationId, businessId, new Date());
    if (!cell) break;
    let candidates: Candidate[] = [];
    let error: string | null = null;
    let retry = false;
    try {
      candidates = await search(cell, deps);
    } catch (e) {
      error = (e as Error).message;
      if (e instanceof RateLimited) {
        retry = cell.attempts + 1 < MAX_ATTEMPTS;
        overpassBackoffUntil = Date.now() + 30_000 * (cell.attempts + 1);
      } else retry = false;
    }

    await withBusinessScope(organizationId, businessId, async (tx) => {
      const job = await tx.discoveryJob.findUnique({ where: { id: cell.jobId } });
      if (!job) return;
      if (error) {
        await tx.discoveryCell.update({ where: { id: cell.id }, data: retry ? { status: "pending", error } : { status: "failed", error, finishedAt: new Date() } });
        if (!retry) await tx.discoveryJob.update({ where: { id: job.id }, data: { cellsDone: { increment: 1 }, lastError: error } });
        return;
      }
      const room = Math.max(0, job.maxProspects - job.found);
      const stats = await upsertCandidates(tx, businessId, job.id, candidates, { autoEnrich: job.autoEnrich, room });
      await tx.discoveryCell.update({ where: { id: cell.id }, data: { status: "done", found: stats.created, finishedAt: new Date(), error: null } });
      await tx.discoveryJob.update({ where: { id: job.id }, data: { cellsDone: { increment: 1 }, found: { increment: stats.created }, duplicates: { increment: stats.duplicates } } });
    });
    if (!error || !retry) done++;
    await finishJobsIfComplete(organizationId, businessId);
  }
  return done;
}

/** Marks a job done when no cells are left, or when it reached its prospect cap (leaving the rest cancelled). */
export async function finishJobsIfComplete(organizationId: string, businessId: string) {
  await withBusinessScope(organizationId, businessId, async (tx) => {
    const running = await tx.discoveryJob.findMany({ where: { businessId, status: "running" } });
    for (const job of running) {
      if (job.found >= job.maxProspects) {
        await tx.discoveryCell.updateMany({ where: { jobId: job.id, status: { in: ["pending", "running"] } }, data: { status: "cancelled" } });
        await tx.discoveryJob.update({ where: { id: job.id }, data: { status: "done", finishedAt: new Date(), lastError: `Stopped at the limit of ${job.maxProspects} prospects.` } });
        continue;
      }
      const open = await tx.discoveryCell.count({ where: { jobId: job.id, status: { in: ["pending", "running"] } } });
      if (open === 0) await tx.discoveryJob.update({ where: { id: job.id }, data: { status: "done", finishedAt: new Date() } });
    }
  });
}

// ---- enrichment ---------------------------------------------------------------------------------------------------

type Claimed = { id: string; name: string; website: string | null; email: string | null; category: string | null; address: string | null; phone: string | null; enrichAttempts: number };

async function claimProspects(organizationId: string, businessId: string, limit: number, now: Date): Promise<Claimed[]> {
  return withBusinessScope(organizationId, businessId, async (tx) => {
    await tx.prospect.updateMany({ where: { enrichStatus: "running", enrichStartedAt: { lt: new Date(now.getTime() - STALE_ENRICH_MS) } }, data: { enrichStatus: "pending" } });
    const rows = await tx.$queryRaw<Claimed[]>`
      SELECT id, name, website, email, category, address, phone, "enrichAttempts" FROM "Prospect"
      WHERE "businessId" = ${businessId} AND "enrichStatus" = 'pending'
      ORDER BY "createdAt" ASC LIMIT ${limit} FOR UPDATE SKIP LOCKED`;
    if (rows.length) await tx.prospect.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { enrichStatus: "running", enrichStartedAt: now, enrichAttempts: { increment: 1 } } });
    return rows;
  });
}

/** Enriches pending prospects, a few at a time, for up to `budgetMs`. A shared crawler keeps per-host spacing. */
export async function runEnrichment(organizationId: string, businessId: string, budgetMs: number, deps: RunnerDeps = {}, concurrency = 3): Promise<number> {
  const started = Date.now();
  const crawler = deps.enrichDeps?.crawler ?? new PoliteCrawler();
  let done = 0;
  while (Date.now() - started < budgetMs) {
    const batch = await claimProspects(organizationId, businessId, concurrency, new Date());
    if (!batch.length) break;
    await Promise.all(
      batch.map(async (p) => {
        const input: EnrichInput = { name: p.name, website: p.website, knownEmail: p.email, category: p.category, address: p.address, phone: p.phone };
        try {
          const result = await enrichProspect(input, { ...deps.enrichDeps, crawler });
          await withBusinessScope(organizationId, businessId, (tx) => applyEnrichment(tx, businessId, p.id, input, result));
        } catch (e) {
          await withBusinessScope(organizationId, businessId, (tx) =>
            tx.prospect.update({
              where: { id: p.id },
              data: p.enrichAttempts + 1 >= MAX_ATTEMPTS ? { enrichStatus: "failed", enrichError: (e as Error).message.slice(0, 300) } : { enrichStatus: "pending", enrichError: (e as Error).message.slice(0, 300) },
            })
          );
        }
        done++;
      })
    );
  }
  return done;
}
