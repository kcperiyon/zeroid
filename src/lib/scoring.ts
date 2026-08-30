// Lead scoring — see docs/build-spec.md §6/§25 (build-spec alteration: weights
// are per-business config, not a global constant). Every weight is "how many
// of the 100 total points this factor is worth"; every factor value coming
// in is 0-100 ("how strong is this factor for this lead"), so the weighted
// sum below lands in 0-100 too.

export interface ScoringWeights {
  icpFit: number;
  problemSeverity: number;
  purchaseIntent: number;
  budgetFit: number;
  urgency: number;
  engagement: number;
  decisionAuthority: number;
}

// Matches docs/build-spec.md §25's table — sums to 100.
export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  icpFit: 15,
  problemSeverity: 20,
  purchaseIntent: 20,
  budgetFit: 15,
  urgency: 15,
  engagement: 10,
  decisionAuthority: 5,
};

export interface LeadFactors {
  icpScore: number | null;
  problemSeverity: number | null;
  purchaseIntent: number | null;
  budgetFit: number | null;
  urgency: number | null;
  engagement: number | null;
  decisionAuthority: number | null;
}

const FACTOR_TO_WEIGHT_KEY: Record<keyof ScoringWeights, keyof LeadFactors> = {
  icpFit: "icpScore",
  problemSeverity: "problemSeverity",
  purchaseIntent: "purchaseIntent",
  budgetFit: "budgetFit",
  urgency: "urgency",
  engagement: "engagement",
  decisionAuthority: "decisionAuthority",
};

/**
 * Weighted average over whatever factors are actually filled in — missing
 * factors don't count against the lead, they just drop out of both the
 * numerator and denominator. Returns null if nothing's been entered yet
 * (an unscored lead, not a zero-scored one).
 */
export function calculateLeadScore(factors: LeadFactors, weights: ScoringWeights): number | null {
  let weightedSum = 0;
  let weightTotal = 0;

  for (const weightKey of Object.keys(weights) as Array<keyof ScoringWeights>) {
    const factorKey = FACTOR_TO_WEIGHT_KEY[weightKey];
    const value = factors[factorKey];
    if (value == null) continue;
    weightedSum += value * weights[weightKey];
    weightTotal += weights[weightKey];
  }

  if (weightTotal === 0) return null;
  return Math.round(weightedSum / weightTotal);
}

export type LeadTemperature = "hot" | "warm" | "cold" | "unscored";

export function classifyTemperature(
  score: number | null,
  thresholds: { hotAt: number; warmAt: number }
): LeadTemperature {
  if (score == null) return "unscored";
  if (score >= thresholds.hotAt) return "hot";
  if (score >= thresholds.warmAt) return "warm";
  return "cold";
}
