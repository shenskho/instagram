import type { Brief, EditPlan, StyleSettings, TranscriptSegment } from "@autoreel/shared";

/** What the engine's `autoedit analyze` writes (subset used by directors). */
export interface Analysis {
  info: { width: number; height: number; duration: number; fps: number };
  pauses: Array<[number, number]>;
  camera: { static: boolean; score: number | null };
  person_track: Array<{ t: number; present: boolean; head_x?: number; head_y?: number; head_w?: number | null; shot?: string | null; area?: number }>;
  keyframes: Array<{ t: number; path: string }>;
  /** Where someone speaks (voice activity), written by analyze since v0.2. */
  speech?: { has_audio: boolean; seconds: number; regions: Array<[number, number]> };
}

export interface DirectorInput {
  analysis: Analysis;
  transcript: TranscriptSegment[];   // confirmed by the user
  style: StyleSettings;
  sourcePath: string;                // as the plan should reference it (relative to the plan file)
  outputPath: string;
  note?: string;                     // user's revision note
  previousPlan?: EditPlan;
  brief?: Partial<Brief>;            // point of view, description, options that must appear
  clips?: Array<{ start: number; end: number }>; // boundaries when several uploads were joined
  title?: string;
}

export interface Director {
  readonly name: "rule" | "claude";
  createPlan(input: DirectorInput): Promise<EditPlan>;
}
