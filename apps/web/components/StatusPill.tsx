import { STATUS_LABELS_FA, type VideoStatus } from "@autoreel/shared";

const TONE: Record<VideoStatus, string> = {
  uploaded: "bg-violet-wash text-violet-deep",
  analyzing: "bg-violet-wash text-violet-deep",
  awaiting_transcript: "bg-cap text-ink",
  directing: "bg-violet-wash text-violet-deep",
  rendering: "bg-violet-wash text-violet-deep",
  ready: "bg-ok/15 text-[#0f7a48]",
  failed: "bg-danger/12 text-danger",
};

export function StatusPill({ status }: { status: VideoStatus }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[13px] font-bold ${TONE[status]}`}>{STATUS_LABELS_FA[status]}</span>;
}

export function Progress({ value, busy }: { value: number; busy: boolean }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-line" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
      <div className={`h-full rounded-full bg-violet transition-[width] duration-500 ${busy ? "working" : ""}`} style={{ width: `${Math.max(4, value)}%` }} />
    </div>
  );
}
