"use client";
import Link from "next/link";
import { StatusPill, Progress } from "./StatusPill";
import { BUSY, fileUrl, type VideoRow } from "@/lib/types";
import { clock, when } from "@/lib/format";

export function VideoList({ items }: { items: VideoRow[] }) {
  if (!items.length) {
    return (
      <div className="rounded-2xl border border-dashed border-line px-6 py-14 text-center">
        <p className="text-lg font-black">هنوز ویدیویی نداری</p>
        <p className="mt-2 text-ink-soft">یک ویدیوی عمودی آپلود کن تا ادیتش شروع بشه. بعد از تحلیل، متنش رو برای تأیید نشونت می‌دم.</p>
      </div>
    );
  }
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-white">
      {items.map((v) => {
        const busy = BUSY.includes(v.status);
        return (
          <li key={v.id}>
            <Link href={`/videos/${v.id}`} className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-paper">
              <span className="relative h-[86px] w-[48px] shrink-0 overflow-hidden rounded-[9px] bg-ink">
                {/* first keyframe after analysis */}
                <img src={fileUrl(`videos/${v.id}/analysis/keyframes/t001.00.jpg`)} alt="" className="h-full w-full object-cover"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-[17px] font-bold">{v.title}</span>
                  <StatusPill status={v.status} />
                </span>
                <span className="mt-1 block text-sm text-ink-soft">
                  {when(v.createdAt)}{v.duration ? ` — مدت ${clock(v.duration)}` : ""}
                  {v.status === "failed" && v.error ? ` — ${v.error.split("\n")[0].slice(0, 90)}` : ""}
                </span>
                {busy && <span className="mt-2 block max-w-sm"><Progress value={v.progress} busy /></span>}
                {busy && v.stage && <span className="mt-1 block text-xs text-ink-faint">{v.stage}</span>}
              </span>
              {v.status === "awaiting_transcript" && <span className="cap shrink-0 py-1 text-sm font-black">متن رو تأیید کن</span>}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
