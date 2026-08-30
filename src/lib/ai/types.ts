// AI provider abstraction — see docs/build-spec.md §7. No route or component
// should ever import an SDK (@anthropic-ai/sdk, etc.) directly; everything
// goes through generate()/classify() in ./index.ts, which resolves a
// provider via the router and meters the call. This is what lets a provider
// be swapped or a task re-routed to a cheaper model without touching
// call sites.

export type AiTask =
  | "qualification_chat"
  | "lead_classification"
  | "content_generation"
  | "research"
  | "follow_up_draft";

export interface GenerateInput {
  system: string;
  prompt: string;
  maxTokens?: number;
}

export interface AiResult {
  text: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
}

export interface AiProvider {
  readonly name: string;
  generate(input: GenerateInput, model: string): Promise<AiResult>;
}

export interface ModelPricing {
  /** USD per 1,000 input tokens. */
  usdPerKIn: number;
  /** USD per 1,000 output tokens. */
  usdPerKOut: number;
}
