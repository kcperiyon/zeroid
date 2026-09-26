// Phase 3 (build-spec §12): attribution + predictive scoring, built only from
// data Zeroid really has -- each lead's creation channel and stage, plus its
// score. Honest limits, stated on the page too:
//  - Attribution is FIRST-TOUCH. Zeroid records one source per lead, not a
//    touchpoint history, so true multi-touch attribution isn't possible yet.
//  - No revenue: nothing creates Deal rows, so outcomes are won/lost/open
//    counts, not money.
//  - "Prediction" is a transparent smoothed-rates model, not ML, and it
//    refuses to guess until there are enough closed leads to learn from.

export type InsightLead = {
  id: string;
  stage: string;
  channel: string;
  leadScore: number | null;
};

export const MIN_CLOSED_FOR_PREDICTION = 20;

const isWon = (l: InsightLead) => l.stage === "won";
const isLost = (l: InsightLead) => l.stage === "lost";
const isClosed = (l: InsightLead) => isWon(l) || isLost(l);

export type ChannelRow = {
  channel: string;
  leads: number;
  won: number;
  lost: number;
  open: number;
  winRate: number | null;
};

export function attributionByChannel(leads: InsightLead[]): ChannelRow[] {
  const groups = new Map<string, InsightLead[]>();
  for (const l of leads) groups.set(l.channel, [...(groups.get(l.channel) ?? []), l]);

  return [...groups.entries()]
    .map(([channel, ls]) => {
      const won = ls.filter(isWon).length;
      const lost = ls.filter(isLost).length;
      return {
        channel,
        leads: ls.length,
        won,
        lost,
        open: ls.length - won - lost,
        winRate: won + lost > 0 ? won / (won + lost) : null,
      };
    })
    .sort((a, b) => b.leads - a.leads);
}

export function scoreBucket(score: number | null): string {
  if (score == null) return "unscored";
  if (score >= 70) return "70+";
  if (score >= 40) return "40-69";
  return "0-39";
}

const PRIOR_STRENGTH = 5;
const logit = (p: number) => Math.log(p / (1 - p));
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
const clamp = (p: number) => Math.min(0.97, Math.max(0.03, p));

export type Prediction =
  | { ready: false; closedCount: number; needed: number }
  | { ready: true; closedCount: number; baseRate: number; byLead: Map<string, number> };

/**
 * Win probability for each OPEN lead. Each closed lead votes on how well its
 * channel and score bucket convert; both rates are shrunk toward the
 * business's overall win rate (so a channel with 2 leads can't claim 100%),
 * then combined in log-odds space relative to that base rate.
 */
export function predictWinProbabilities(leads: InsightLead[]): Prediction {
  const closed = leads.filter(isClosed);
  if (closed.length < MIN_CLOSED_FOR_PREDICTION) {
    return { ready: false, closedCount: closed.length, needed: MIN_CLOSED_FOR_PREDICTION };
  }

  const baseRate = clamp(closed.filter(isWon).length / closed.length);

  const shrunk = (group: InsightLead[]) => {
    const won = group.filter(isWon).length;
    return clamp((won + PRIOR_STRENGTH * baseRate) / (group.length + PRIOR_STRENGTH));
  };
  const byChannel = (channel: string) => shrunk(closed.filter((l) => l.channel === channel));
  const byBucket = (bucket: string) => shrunk(closed.filter((l) => scoreBucket(l.leadScore) === bucket));

  const byLead = new Map<string, number>();
  for (const l of leads.filter((x) => !isClosed(x))) {
    const combined = logit(byChannel(l.channel)) + logit(byBucket(scoreBucket(l.leadScore))) - logit(baseRate);
    byLead.set(l.id, clamp(sigmoid(combined)));
  }
  return { ready: true, closedCount: closed.length, baseRate, byLead };
}
