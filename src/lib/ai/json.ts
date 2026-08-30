/**
 * Models sometimes wrap JSON in a markdown code fence despite being told not
 * to. Strip that before parsing rather than trusting the instruction alone.
 */
export function parseJsonResponse<T>(text: string): T {
  const stripped = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  return JSON.parse(stripped) as T;
}
