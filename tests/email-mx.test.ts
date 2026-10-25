import { describe, expect, it } from "vitest";
import { checkDomains } from "../src/lib/email-campaigns/mx";

describe("checkDomains", () => {
  it("checks each unique domain once, in parallel (a slow resolver cannot stall a launch)", async () => {
    const calls: string[] = [];
    const slow = async (d: string) => {
      calls.push(d);
      await new Promise((r) => setTimeout(r, 150));
      return d !== "dead.example";
    };
    const domains = ["a.example", "b.example", "A.example", "c.example", "dead.example", "d.example", "e.example", "f.example", "b.example"];
    const started = Date.now();
    const result = await checkDomains(domains, slow, 16);
    const took = Date.now() - started;

    expect(calls.sort()).toEqual(["a.example", "b.example", "c.example", "d.example", "dead.example", "e.example", "f.example"]);
    expect(result.get("dead.example")).toBe(false);
    expect(result.get("a.example")).toBe(true);
    // 7 lookups of 150 ms done serially would take >1000 ms; in parallel it is about one lookup.
    expect(took).toBeLessThan(600);
  });

  it("treats a failing lookup as OK so a flaky resolver never drops a real prospect", async () => {
    const boom = async () => {
      throw new Error("resolver exploded");
    };
    const result = await checkDomains(["x.example"], boom);
    expect(result.get("x.example")).toBe(true);
  });

  it("respects the concurrency limit", async () => {
    let active = 0;
    let peak = 0;
    const probe = async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 30));
      active--;
      return true;
    };
    await checkDomains(Array.from({ length: 30 }, (_, i) => `d${i}.example`), probe, 5);
    expect(peak).toBeLessThanOrEqual(5);
  });
});
