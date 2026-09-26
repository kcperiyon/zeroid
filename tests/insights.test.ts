import { describe, expect, it } from "vitest";
import {
  attributionByChannel,
  predictWinProbabilities,
  scoreBucket,
  MIN_CLOSED_FOR_PREDICTION,
  type InsightLead,
} from "@/lib/insights";

let n = 0;
const lead = (channel: string, stage: string, leadScore: number | null = null): InsightLead => ({
  id: `l${n++}`,
  channel,
  stage,
  leadScore,
});

describe("attributionByChannel", () => {
  it("counts outcomes per channel and computes win rate over closed leads only", () => {
    const rows = attributionByChannel([
      lead("google", "won"),
      lead("google", "won"),
      lead("google", "lost"),
      lead("google", "new"),
      lead("csv", "new"),
    ]);
    const google = rows.find((r) => r.channel === "google")!;
    expect(google).toMatchObject({ leads: 4, won: 2, lost: 1, open: 1 });
    expect(google.winRate).toBeCloseTo(2 / 3);
    expect(rows.find((r) => r.channel === "csv")!.winRate).toBeNull();
  });
});

describe("predictWinProbabilities", () => {
  it("refuses to predict without enough closed leads", () => {
    const p = predictWinProbabilities([lead("google", "won"), lead("google", "new")]);
    expect(p).toMatchObject({ ready: false, closedCount: 1, needed: MIN_CLOSED_FOR_PREDICTION });
  });

  it("ranks a strong channel/score above a weak one once there is data", () => {
    const leads: InsightLead[] = [];
    for (let i = 0; i < 12; i++) leads.push(lead("referral", i < 10 ? "won" : "lost", 80));
    for (let i = 0; i < 12; i++) leads.push(lead("csv", i < 2 ? "won" : "lost", 20));
    const strong = lead("referral", "new", 80);
    const weak = lead("csv", "new", 20);
    const p = predictWinProbabilities([...leads, strong, weak]);
    expect(p.ready).toBe(true);
    if (!p.ready) return;
    expect(p.byLead.get(strong.id)!).toBeGreaterThan(p.byLead.get(weak.id)!);
    expect(p.byLead.get(strong.id)!).toBeLessThan(0.98);
    expect(p.byLead.get(weak.id)!).toBeGreaterThan(0.02);
  });

  it("does not let a tiny channel claim certainty", () => {
    const leads: InsightLead[] = [];
    for (let i = 0; i < 24; i++) leads.push(lead("google", i % 2 === 0 ? "won" : "lost", 50));
    leads.push(lead("etsy", "won", 50)); // one lucky win
    const probe = lead("etsy", "new", 50);
    const p = predictWinProbabilities([...leads, probe]);
    if (!p.ready) throw new Error("expected ready");
    expect(p.byLead.get(probe.id)!).toBeLessThan(0.8);
  });

  it("buckets scores", () => {
    expect(scoreBucket(null)).toBe("unscored");
    expect(scoreBucket(10)).toBe("0-39");
    expect(scoreBucket(55)).toBe("40-69");
    expect(scoreBucket(90)).toBe("70+");
  });
});
