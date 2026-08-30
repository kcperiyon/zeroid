// Public AI API — every caller in the app uses these, never an SDK or a
// provider adapter directly. See docs/build-spec.md §7.

import { resolveProvider } from "./router";
import { meterAiCall } from "./metering";
import type { AiResult, AiTask } from "./types";

export type { AiTask, AiResult, GenerateInput } from "./types";
export { buildPrompt, buildBusinessSystemPrompt } from "./prompt";

export async function generate(
  organizationId: string,
  businessId: string,
  task: AiTask,
  input: { system: string; prompt: string; maxTokens?: number }
): Promise<AiResult> {
  const { provider, model } = resolveProvider(task);
  return meterAiCall(organizationId, businessId, task, () => provider.generate(input, model));
}
