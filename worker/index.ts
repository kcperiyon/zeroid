/**
 * Zeroid background worker: runs the email-campaign sending loop. One process under PM2
 * ("zeroid-worker"), separate from the web app so a slow send never blocks a web request.
 *
 * Each tick it walks organizations -> businesses and asks the engine to send whatever is due.
 * The queue is the CampaignMessage table itself (status + scheduledFor, claimed with
 * FOR UPDATE SKIP LOCKED), so running a second worker is safe: they never claim the same message.
 *
 * Run:  npm run worker      (loads .env; needs DATABASE_URL and, to send, the sender settings)
 */
import { db } from "../src/lib/db";
import { withOrgScope } from "../src/lib/tenant-db";
import { processDueMessages } from "../src/lib/email-campaigns/engine";
import { liveSendingEnabled, parseAllowList } from "../src/lib/email-campaigns/guard";
import { pollBusinessMailboxes } from "../src/lib/email-campaigns/mailbox";
import { upgradeIdentitySecrets } from "../src/lib/email-campaigns/upgrade-secrets";

const TICK_MS = Number(process.env.WORKER_TICK_MS ?? 30_000);
let running = false;
let stopping = false;

const log = (...args: unknown[]) => console.log(new Date().toISOString(), ...args);

async function tick() {
  if (running || stopping) return;
  running = true;
  const totals = { sent: 0, skipped: 0, rescheduled: 0, failed: 0, cancelled: 0 };
  try {
    const orgs = await db.organization.findMany({ select: { id: true } });
    for (const org of orgs) {
      const businesses = await withOrgScope(org.id, (tx) => tx.business.findMany({ where: { organizationId: org.id }, select: { id: true } }));
      for (const business of businesses) {
        if (stopping) break;
        try {
          // Capture replies / bounces first, so a reply stops the next step before it is sent.
          const inbox = await pollBusinessMailboxes(org.id, business.id);
          if (inbox.fetched > 0) log(`mailbox: ${inbox.fetched} new message(s), ${inbox.matched} matched (${inbox.replies} replies, ${inbox.bounces} bounces)`);
          const r = await processDueMessages(org.id, business.id);
          for (const k of Object.keys(totals) as (keyof typeof totals)[]) totals[k] += r[k];
        } catch (error) {
          // One business failing must never stop the others.
          console.error(new Date().toISOString(), `business ${business.id} failed:`, error);
        }
      }
    }
    if (Object.values(totals).some((n) => n > 0)) log("tick:", JSON.stringify(totals));
  } catch (error) {
    console.error(new Date().toISOString(), "tick failed:", error);
  } finally {
    running = false;
  }
}

async function main() {
  const allow = parseAllowList().size;
  log(
    `zeroid-worker started. Tick every ${TICK_MS / 1000}s. ` +
      `Sandbox allow-list: ${allow} address(es). Live sending: ${liveSendingEnabled() ? "ENABLED" : "disabled (sandbox only)"}.`
  );
  try {
    const n = await upgradeIdentitySecrets();
    if (n > 0) log(`encrypted stored credentials on ${n} sending identit${n === 1 ? "y" : "ies"}.`);
  } catch (error) {
    console.error("could not upgrade stored credentials:", error);
  }
  const timer = setInterval(() => void tick(), TICK_MS);
  void tick();

  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log(`${signal} received, finishing the current tick and exiting.`);
    clearInterval(timer);
    const started = Date.now();
    while (running && Date.now() - started < 30_000) await new Promise((r) => setTimeout(r, 250));
    await db.$disconnect().catch(() => undefined);
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

void main();
