// Multi-step follow-up sequences, one per situation (vision doc §28's "full
// situation-based sequence library"). A sequence is a plan, not automation:
// the AI drafts each step's message, a human reviews/edits, and scheduling
// turns each step into a dated Task for a person to send. Zeroid has no
// scheduler and AI Autopilot is deliberately held off, so nothing here ever
// sends a message by itself.

export type SequenceStep = { dayOffset: number; intent: string };

export const FOLLOW_UP_SEQUENCES: Record<string, SequenceStep[]> = {
  general: [
    { dayOffset: 2, intent: "Light check-in, ask if they had any questions." },
    { dayOffset: 6, intent: "Share one genuinely useful thing relevant to their situation." },
    { dayOffset: 12, intent: "Short final nudge that leaves the door open." },
  ],
  thinking_it_over: [
    { dayOffset: 3, intent: "Give one piece of information that helps them decide, no pressure." },
    { dayOffset: 8, intent: "Ask what's still unclear or holding the decision." },
    { dayOffset: 15, intent: "Offer a short call to answer anything left, then step back." },
  ],
  too_expensive: [
    { dayOffset: 2, intent: "Reframe around the outcome/value they get, without inventing any discount." },
    { dayOffset: 7, intent: "Explain what's actually included and how the cost compares to the problem it solves." },
    { dayOffset: 14, intent: "Ask if a different scope or option from the product list would fit better." },
  ],
  needs_approval: [
    { dayOffset: 2, intent: "Offer something that helps them make the case internally (e.g. a one-pager)." },
    { dayOffset: 7, intent: "Ask if the approver has questions you can answer directly." },
    { dayOffset: 14, intent: "Check in on the approval timeline without rushing them." },
  ],
  not_ready: [
    { dayOffset: 7, intent: "Acknowledge timing, ask what would need to be true for it to be the right time." },
    { dayOffset: 30, intent: "Check back in around the time they indicated, briefly." },
  ],
  comparing_alternatives: [
    { dayOffset: 2, intent: "Confident, non-defensive summary of this business's real differentiators." },
    { dayOffset: 6, intent: "Offer to answer any question that would help their comparison." },
    { dayOffset: 12, intent: "Ask where they've landed and whether anything is still open." },
  ],
  interested_but_busy: [
    { dayOffset: 3, intent: "Very short, a single yes/no question that's easy to answer." },
    { dayOffset: 8, intent: "One-line reminder with a specific easy next step." },
  ],
  referral_ask: [
    { dayOffset: 7, intent: "Thank them, then one easy question: do they know anyone else who'd benefit?" },
    { dayOffset: 21, intent: "Light follow-up on the referral ask, no pressure, no incentives." },
  ],
  no_response: [
    { dayOffset: 2, intent: "One short line, easy to ignore without guilt." },
    { dayOffset: 6, intent: "A different angle or one useful tip, still very short." },
    { dayOffset: 14, intent: "Final polite close-the-loop message that leaves the door open." },
  ],
};

export function sequenceFor(situation: string | undefined): SequenceStep[] {
  return FOLLOW_UP_SEQUENCES[situation ?? "general"] ?? FOLLOW_UP_SEQUENCES.general;
}
