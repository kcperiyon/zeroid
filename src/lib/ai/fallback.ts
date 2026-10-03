import { PROVIDERS, FALLBACK_ROUTE } from "./router";
import type { AiProvider, AiResult, GenerateInput } from "./types";

/**
 * Is this error "the provider is unavailable / out of credit / rejecting our
 * key" (worth trying a backup) rather than "this particular request was bad"
 * (a backup would fail the same way)? Anthropic reports exhausted credit as a
 * 400 with a billing message, not a 402, so the message is checked too.
 */
export function isProviderOutage(error: unknown): boolean {
  const e = error as { status?: number; message?: string } | null;
  const status = typeof e?.status === "number" ? e.status : undefined;
  const message = (e?.message ?? "").toLowerCase();

  if (status !== undefined && [401, 402, 403, 408, 429, 500, 502, 503, 504, 529].includes(status)) return true;
  if (/credit balance|insufficient_quota|billing|quota|overloaded|rate limit|api_key is not set|api key/.test(message)) return true;
  if (/fetch failed|econnreset|econnrefused|etimedout|enotfound|socket|timeout|network/.test(message)) return true;
  return false;
}

// After the primary fails with an outage, skip it for a few minutes so every
// call during an outage doesn't pay for a failing round-trip first.
const PRIMARY_COOLDOWN_MS = 5 * 60_000;
let primaryDownUntil = 0;

export function resetFallbackState() {
  primaryDownUntil = 0;
}

type Configurable = AiProvider & { isConfigured?: () => boolean };

function fallbackAvailable(): Configurable | null {
  const provider = PROVIDERS[FALLBACK_ROUTE.provider] as Configurable | undefined;
  if (!provider) return null;
  if (provider.isConfigured && !provider.isConfigured()) return null;
  return provider;
}

/**
 * Runs the primary route; on a provider outage, transparently retries on the
 * fallback provider (Gemini). The returned result carries the model that
 * actually answered, so AiUsageLog records it and credits are charged at that
 * model's rate. Ordinary request errors are rethrown untouched.
 */
export async function runWithFallback(
  primary: { provider: AiProvider; model: string },
  input: GenerateInput
): Promise<AiResult> {
  const backup = fallbackAvailable();
  const useBackupFirst = backup && Date.now() < primaryDownUntil;

  if (!useBackupFirst) {
    try {
      return await primary.provider.generate(input, primary.model);
    } catch (error) {
      if (!backup || !isProviderOutage(error)) throw error;
      primaryDownUntil = Date.now() + PRIMARY_COOLDOWN_MS;
      console.warn(
        `AI primary (${primary.provider.name}) unavailable, falling back to ${backup.name}:`,
        error instanceof Error ? error.message : error
      );
    }
  }
  return backup!.generate(input, FALLBACK_ROUTE.model);
}
