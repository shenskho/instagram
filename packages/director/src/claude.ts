/**
 * Claude director (roadmap step 3). Same interface as the rule director.
 * Inputs it will send: confirmed transcript with word times, pauses, person track, keyframes (images),
 * page style rules and the engine toolbox (packages/engine/docs/toolbox.md). It returns an edit plan,
 * then validate -> fix loop -> render -> QC sheet review with vision.
 */
import type { Director, DirectorInput } from "./types.ts";
import type { EditPlan } from "@autoreel/shared";

export class ClaudeDirector implements Director {
  readonly name = "claude" as const;
  constructor(private apiKey: string, private model = process.env.CLAUDE_MODEL ?? "claude-opus-5-5") {}

  async createPlan(_input: DirectorInput): Promise<EditPlan> {
    void this.apiKey; void this.model;
    throw new Error("Claude director is not implemented yet (roadmap step 3). Set DIRECTOR=rule.");
  }
}
