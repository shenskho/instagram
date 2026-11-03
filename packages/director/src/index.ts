export * from "./types.ts";
export { RuleDirector } from "./rule.ts";
export { ClaudeDirector } from "./claude.ts";
import { RuleDirector } from "./rule.ts";
import { ClaudeDirector } from "./claude.ts";
import type { Director } from "./types.ts";

/** DIRECTOR=claude needs ANTHROPIC_API_KEY; anything else falls back to the rule director. */
export function getDirector(env = process.env): Director {
  if (env.DIRECTOR === "claude" && env.ANTHROPIC_API_KEY) return new ClaudeDirector(env.ANTHROPIC_API_KEY);
  return new RuleDirector();
}
