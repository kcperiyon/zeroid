import Anthropic from "@anthropic-ai/sdk";
import type { AiProvider, AiResult, GenerateInput } from "../types";

let client: Anthropic | null = null;

function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it to .env.local to enable real AI calls — see .env.example."
    );
  }
  client ??= new Anthropic({ apiKey });
  return client;
}

export const claudeProvider: AiProvider = {
  name: "claude",
  async generate(input: GenerateInput, model: string): Promise<AiResult> {
    const response = await getClient().messages.create({
      model,
      max_tokens: input.maxTokens ?? 1024,
      system: input.system,
      messages: [{ role: "user", content: input.prompt }],
    });

    const text = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");

    return {
      text,
      model,
      tokensIn: response.usage.input_tokens,
      tokensOut: response.usage.output_tokens,
    };
  },
};
