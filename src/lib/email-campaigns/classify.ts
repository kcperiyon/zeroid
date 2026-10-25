import { generate } from "@/lib/ai";
import { parseJsonResponse } from "@/lib/ai/json";

export type ReplyClass = "interested" | "not_now" | "out_of_office" | "unsubscribe" | "other";

/** Removes the quoted history and signature noise so classification sees only what the person wrote. */
export function stripQuoted(text: string): string {
  const lines = text.replace(/\r/g, "").split("\n");
  const out: string[] = [];
  for (const line of lines) {
    if (/^\s*>/.test(line)) continue;
    if (/^\s*On .{5,120} wrote:\s*$/i.test(line) || /^\s*-{2,}\s*Original Message\s*-{2,}/i.test(line) || /^\s*From:\s.+@/i.test(line)) break;
    out.push(line);
  }
  return out.join("\n").trim().slice(0, 2000);
}

const RULES: { cls: ReplyClass; re: RegExp }[] = [
  { cls: "unsubscribe", re: /\b(unsubscribe|remove me|take me off|stop (emailing|sending|contacting)|do not (email|contact)|don'?t (email|contact) me|opt[- ]?out)\b/i },
  { cls: "out_of_office", re: /\b(out of (the )?office|automatic reply|auto[- ]?reply|on (annual )?leave|away from (the )?office|currently (away|out)|will (be )?(back|return)(ing)? (on|in))\b/i },
  { cls: "interested", re: /\b(interested|tell me more|send (me )?(more )?(info|details|pricing|a proposal|the deck)|let'?s (talk|chat|speak|schedule|set up)|call me|book (a )?(call|meeting|demo)|free (this|next) week|can we (talk|meet|schedule)|sounds (good|great|interesting)|how much|what (does|would) it cost|demo)\b/i },
  { cls: "not_now", re: /\b(not (right )?now|not interested|no thanks|no thank you|maybe later|reach out (later|next)|next (quarter|year|month)|bad timing|not a (good )?fit|already (have|use|work)|we are (all )?set|not looking)\b/i },
];

/** Cheap, deterministic first pass. Returns null when the text is ambiguous. */
export function classifyByRules(text: string): ReplyClass | null {
  const t = stripQuoted(text);
  if (!t) return null;
  // Order matters: an explicit opt-out or auto-reply beats a polite "interested later".
  for (const r of RULES) if (r.re.test(t)) return r.cls;
  return null;
}

/**
 * Rules first (free). Ambiguous replies go to one cheap AI call; if the AI is unavailable (no
 * credits, provider down) the reply is "other", which creates a task for a human -- never a wrong
 * automatic decision.
 */
export async function classifyReply(
  text: string,
  ai?: { organizationId: string; businessId: string }
): Promise<{ cls: ReplyClass; via: "rules" | "ai" | "fallback" }> {
  const byRules = classifyByRules(text);
  if (byRules) return { cls: byRules, via: "rules" };
  if (!ai) return { cls: "other", via: "fallback" };
  try {
    const out = await generate(ai.organizationId, ai.businessId, "lead_classification", {
      system: "You classify replies to a B2B cold email. Reply with ONLY compact JSON.",
      prompt:
        'Classify the reply into exactly one of: "interested" (wants to talk / learn more), "not_now" (declines or later), ' +
        '"out_of_office" (auto-reply), "unsubscribe" (wants no more email), "other" (unclear, needs a human).\n' +
        `Reply text:\n"""${stripQuoted(text).slice(0, 1200)}"""\nJSON: {"class":"..."}`,
      maxTokens: 40,
    });
    const parsed = parseJsonResponse<{ class?: string }>(out.text);
    const cls = parsed?.class;
    if (cls === "interested" || cls === "not_now" || cls === "out_of_office" || cls === "unsubscribe" || cls === "other") {
      return { cls, via: "ai" };
    }
  } catch {
    // fall through
  }
  return { cls: "other", via: "fallback" };
}
