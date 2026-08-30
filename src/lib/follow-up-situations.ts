// Situation-based follow-up guidance — see docs/build-spec.md §28/vision doc
// §28. Shared between the API route and the UI so the dropdown options and
// the prompt guidance never drift apart.

export const FOLLOW_UP_SITUATIONS = [
  { value: "general", label: "General check-in", guidance: "A light, no-pressure check-in — no specific objection to address." },
  { value: "thinking_it_over", label: "Thinking about it", guidance: "They said they need to think about it. Give them room, don't chase — offer one useful piece of information that helps them decide, not pressure." },
  { value: "too_expensive", label: "Too expensive", guidance: "They raised price as a concern. Reframe around value/outcome, do not offer a discount unless one is already listed as a real product price above, and never invent one." },
  { value: "needs_approval", label: "Needs approval", guidance: "They need someone else's sign-off. Offer to provide anything that would help them make the case internally (e.g. a one-pager), don't pressure them to rush the approver." },
  { value: "not_ready", label: "Not ready", guidance: "They said now isn't the right time. Acknowledge that directly, ask (briefly) what would need to be true for it to be the right time, don't push a timeline on them." },
  { value: "comparing_alternatives", label: "Comparing alternatives", guidance: "They're evaluating other options. Be confident, not defensive or comparative about competitors — focus on this business's actual differentiators from what's already been told to the AI." },
  { value: "interested_but_busy", label: "Interested but busy", guidance: "They're interested but haven't had time. Keep this message very short and make responding easy — a yes/no question, not an essay." },
  { value: "no_response", label: "No response", guidance: "They've gone quiet. Keep it very short, one line, no guilt-tripping, easy to ignore without feeling bad, and leave the door open." },
] as const;

export type FollowUpSituation = (typeof FOLLOW_UP_SITUATIONS)[number]["value"];

export function situationGuidance(situation: string | undefined): string {
  return FOLLOW_UP_SITUATIONS.find((s) => s.value === situation)?.guidance
    ?? FOLLOW_UP_SITUATIONS[0].guidance;
}
