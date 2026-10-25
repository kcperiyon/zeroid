/**
 * A sensible 3-step B2B starting sequence. The lines in [[double brackets]] are prompts the owner
 * MUST rewrite: launching is refused while any remain (see launchCampaign), so an unedited
 * template can never go out to a prospect.
 */
export const DEFAULT_STEPS = [
  {
    position: 1,
    delayDays: 0,
    subject: "Quick question, {{firstName}}",
    body:
      "Hi {{firstName}},\n\n[[One specific sentence about why you are writing to {{company}} and what you noticed about them.]]\n\n" +
      "[[One sentence on how you help companies like theirs, with a concrete result.]]\n\n" +
      "Worth a short conversation?\n\nBest,\n{{senderName}}",
  },
  {
    position: 2,
    delayDays: 3,
    subject: "Re: Quick question, {{firstName}}",
    body:
      "Hi {{firstName}},\n\nFollowing up on my note. [[Add one useful detail or a short example relevant to {{company}}.]]\n\n" +
      "Happy to send more detail if it helps.\n\nBest,\n{{senderName}}",
  },
  {
    position: 3,
    delayDays: 5,
    subject: "Should I close the loop?",
    body:
      "Hi {{firstName}},\n\nI will assume the timing is not right and stop here. If I have this wrong, just reply and we can talk.\n\n" +
      "Either way, best of luck at {{company}}.\n\n{{senderName}}",
  },
] as const;

export const PLACEHOLDER_MARK = /\[\[|\]\]/;
