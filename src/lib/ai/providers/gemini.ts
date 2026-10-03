import type { AiProvider, AiResult, GenerateInput } from "../types";

// Google Gemini via the Generative Language REST API (key auth, no SDK).
// https://ai.google.dev/api/generate-content
//
// Used as the fallback when Anthropic is unavailable or out of credit (see
// ./../fallback.ts). Not live-tested against every task type yet -- the first
// real response should be sanity-checked per task before relying on it for
// quality-sensitive work.

export const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-3.8-flash";

type GeminiResponse = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
  error?: { message?: string; status?: string; code?: number };
};

export class GeminiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

export const geminiProvider: AiProvider & { isConfigured(): boolean } = {
  name: "gemini",
  isConfigured: () => Boolean(process.env.GEMINI_API_KEY),
  async generate(input: GenerateInput, model: string): Promise<AiResult> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new GeminiError("GEMINI_API_KEY is not set.");

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: input.system }] },
          contents: [{ role: "user", parts: [{ text: input.prompt }] }],
          generationConfig: {
            // Thinking tokens count against maxOutputTokens (verified live: a
            // 100-token cap returned an empty answer on gemini-3.8-flash), so
            // leave headroom beyond what the caller asked for.
            maxOutputTokens: (input.maxTokens ?? 1024) + 1024,
            // 3.x models take a thinking *level* (and reject "minimal" and a
            // zero budget); 2.x models take a budget. Keep thinking light --
            // these are short sales-assistant replies, not research.
            thinkingConfig: model.startsWith("gemini-3") ? { thinkingLevel: "low" } : { thinkingBudget: 0 },
          },
        }),
      }
    );

    const raw = await res.text();
    let body: GeminiResponse | null = null;
    try {
      body = raw ? (JSON.parse(raw) as GeminiResponse) : null;
    } catch {
      throw new GeminiError(`Gemini returned a non-JSON response (status ${res.status}).`, res.status);
    }
    if (!res.ok || body?.error) {
      throw new GeminiError(body?.error?.message ?? `Gemini API error (status ${res.status}).`, res.status);
    }

    const text = (body?.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
    if (!text) {
      throw new GeminiError(`Gemini returned no text (finish reason: ${body?.candidates?.[0]?.finishReason ?? "unknown"}).`);
    }
    const usage = body?.usageMetadata ?? {};
    return {
      text,
      model,
      tokensIn: usage.promptTokenCount ?? 0,
      tokensOut: (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0),
    };
  },
};
