// Prompt composition — see docs/build-spec.md §54: assemble from layers
// rather than concatenating strings ad hoc at each call site. Each layer is
// optional; empty ones are skipped rather than emitting a blank heading.

export interface PromptLayer {
  label: string;
  content: string;
}

export function buildPrompt(layers: PromptLayer[]): string {
  return layers
    .filter((layer) => layer.content.trim().length > 0)
    .map((layer) => `## ${layer.label}\n${layer.content.trim()}`)
    .join("\n\n");
}

interface BusinessContextInput {
  business: { name: string; industry: string | null };
  products: { name: string; description: string | null; price: unknown; currency: string }[];
  instructions: { content: string }[];
}

/** The "system rules + business context + product context + compliance rules" layers — the part that's the same regardless of which specific task is running. */
export function buildBusinessSystemPrompt(input: BusinessContextInput): string {
  return buildPrompt([
    {
      label: "System rules",
      content:
        "You are a sales development assistant for the business described below. " +
        "Be accurate, professional, and never invent facts about the business, its " +
        "products, or pricing that aren't given to you here.",
    },
    {
      label: "Business",
      content: `${input.business.name}${input.business.industry ? ` (${input.business.industry})` : ""}`,
    },
    {
      label: "Products",
      content: input.products
        .map((p) => `- ${p.name}${p.price != null ? ` — ${p.currency} ${p.price}` : ""}${p.description ? `: ${p.description}` : ""}`)
        .join("\n"),
    },
    {
      label: "Compliance rules",
      content: input.instructions.map((i) => `- ${i.content}`).join("\n"),
    },
  ]);
}
