import Anthropic from "@anthropic-ai/sdk";

/**
 * Single Claude client. We default to Sonnet 4.6 (fast + structured) and
 * keep Opus 4.7 available for higher-stakes synthesis (the arrival brief
 * is where it most pays off).
 */
const apiKey = process.env.ANTHROPIC_API_KEY;

export const anthropic = new Anthropic({
  apiKey: apiKey ?? "missing-key",
});

export const MODELS = {
  // Tight, structured outputs: daily rhythm, memory extraction.
  fast: "claude-sonnet-4-6",
  // The synthesis moment: arrival brief.
  thinker: "claude-opus-4-7",
} as const;

export function isAnthropicConfigured(): boolean {
  return Boolean(apiKey && apiKey !== "missing-key");
}
