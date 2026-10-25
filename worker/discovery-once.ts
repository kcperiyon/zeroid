/**
 * Runs ONE discovery pass (plan jobs, work some cells, enrich some prospects) and prints the totals,
 * then exits. Handy for watching a job by hand:  npm run discovery:once
 */
import { db } from "../src/lib/db";
import { discoveryTick } from "../src/lib/discovery/tick";

discoveryTick({ onError: (where, e) => console.error(`${where} failed:`, e) })
  .then((t) => console.log("discovery pass:", JSON.stringify(t)))
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
