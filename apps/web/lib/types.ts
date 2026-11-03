import type { Clip, TranscriptSegment, UsageItem, VideoStatus } from "@autoreel/shared";

export interface VideoRow {
  id: string; title: string; status: VideoStatus; stage: string | null; progress: number;
  duration: number | null; error: string | null; createdAt: string; updatedAt: string;
}
export interface VideoDetail {
  video: VideoRow & {
    sourcePath: string; width: number | null; height: number | null;
    analysis: { camera?: { static: boolean }; pauses?: number; keyframes?: number; contact?: string; speech?: number } | null;
    pov: string; description: string; options: string[]; clips: Clip[] | null;
  };
  transcript: { engine: string; segments: TranscriptSegment[]; confirmed: boolean } | null;
  plans: Array<{ id: string; version: number; source: string; note: string | null; usage: UsageItem[]; missing: string[]; validation: { ok: boolean; errors: Array<{ where: string; msg: string }>; warnings: Array<{ where: string; msg: string }>; fixes: Array<{ where: string; msg: string }> } | null; createdAt: string }>;
  renders: Array<{ id: string; planId: string; status: string; outputPath: string | null; qcPath: string | null; duration: number | null; elapsedS: number | null; error: string | null; createdAt: string }>;
}
export const BUSY: VideoStatus[] = ["uploaded", "analyzing", "directing", "rendering"];
export const fileUrl = (rel: string) => `/files/${rel.split("\\").join("/")}`;
