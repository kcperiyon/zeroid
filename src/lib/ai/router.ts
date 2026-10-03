import type { AiProvider, AiTask, ModelPricing } from "./types";
import { claudeProvider } from "./providers/claude";
import { geminiProvider, GEMINI_MODEL } from "./providers/gemini";

// Registry of provider implementations. OpenAI/Kimi adapters land here later
// (build-spec §7/§8) without any call site changing — they just need to
// implement AiProvider and get added to both maps below.
export const PROVIDERS: Record<string, AiProvider> = {
  claude: claudeProvider,
  gemini: geminiProvider,
};

// Backup used when the primary provider is down or out of credit (see
// ./fallback.ts). Only active when GEMINI_API_KEY is set.
export const FALLBACK_ROUTE = { provider: "gemini", model: GEMINI_MODEL };

// Default routing per task — see docs/build-spec.md §7's table. Hardcoded
// for Phase 1 (no admin UI to edit this yet); the shape is already
// "task -> config" so a DB-backed override can replace this lookup later
// without touching callers.
export const TASK_ROUTING: Record<AiTask, { provider: string; model: string }> = {
  qualification_chat: { provider: "claude", model: "claude-sonnet-5" },
  research: { provider: "claude", model: "claude-opus-5" },
  lead_classification: { provider: "claude", model: "claude-haiku-4-5-20251001" },
  content_generation: { provider: "claude", model: "claude-haiku-4-5-20251001" },
  follow_up_draft: { provider: "claude", model: "claude-sonnet-5" },
};

// USD per 1k tokens — approximate, sourced from this account's most recent
// verified pricing note (see the [[skynett-ai-and-channels]] memory) rather
// than re-derived here. VERIFY against Anthropic's current pricing page
// before relying on these for real customer billing — they're a starting
// point for the credit-metering mechanism, not a guarantee of current rates.
export const MODEL_PRICING: Record<string, ModelPricing> = {
  "claude-sonnet-5": { usdPerKIn: 0.003, usdPerKOut: 0.015 },
  "claude-opus-5": { usdPerKIn: 0.005, usdPerKOut: 0.025 },
  "claude-haiku-4-5-20251001": { usdPerKIn: 0.001, usdPerKOut: 0.005 },
  "claude-fable-5": { usdPerKIn: 0.01, usdPerKOut: 0.05 },
  // Placeholder Gemini Flash rates (carried over from 2.5 Flash; the 3.8
  // price was not checked) -- VERIFY against Google's pricing page. Present
  // so fallback calls still debit customers' credits (at a much lower rate
  // than Claude) instead of being silently free.
  "gemini-3.8-flash": { usdPerKIn: 0.0003, usdPerKOut: 0.0025 },
  "gemini-2.5-flash": { usdPerKIn: 0.0003, usdPerKOut: 0.0025 },
};

export function resolveProvider(task: AiTask): { provider: AiProvider; model: string } {
  const route = TASK_ROUTING[task];
  const provider = PROVIDERS[route.provider];
  if (!provider) throw new Error(`No provider registered for "${route.provider}".`);
  return { provider, model: route.model };
}
