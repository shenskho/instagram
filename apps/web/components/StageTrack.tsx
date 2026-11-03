import type { VideoStatus } from "@autoreel/shared";

/** The real sequence a video goes through; the current step wears the caption highlight. */
const STEPS: Array<{ key: VideoStatus[]; label: string }> = [
  { key: ["uploaded"], label: "آپلود" },
  { key: ["analyzing"], label: "تحلیل" },
  { key: ["awaiting_transcript"], label: "تأیید متن" },
  { key: ["directing"], label: "کارگردانی" },
  { key: ["rendering"], label: "رندر" },
  { key: ["ready"], label: "آماده" },
];

export function StageTrack({ status, failedAt }: { status: VideoStatus; failedAt?: number }) {
  const idx = status === "failed" ? (failedAt ?? 1) : STEPS.findIndex((s) => s.key.includes(status));
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-2 text-[15px]">
      {STEPS.map((s, i) => {
        const done = i < idx || status === "ready";
        const current = i === idx && status !== "ready";
        return (
          <li key={s.label} className="flex items-center gap-2">
            {i > 0 && <span className={`h-px w-5 ${done || current ? "bg-ink" : "bg-line"}`} aria-hidden />}
            <span className={
              current ? (status === "failed" ? "rounded-lg bg-danger px-2 py-0.5 font-black text-white" : "cap py-0.5 font-black")
                : done ? "font-bold text-ink" : "text-ink-faint"
            }>
              {s.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
