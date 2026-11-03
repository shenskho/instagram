"use client";
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Shell } from "@/components/Shell";
import { StageTrack } from "@/components/StageTrack";
import { StatusPill, Progress } from "@/components/StatusPill";
import { TranscriptEditor } from "@/components/TranscriptEditor";
import { ResultPanel } from "@/components/ResultPanel";
import { api } from "@/lib/api";
import { clock, faNum } from "@/lib/format";
import { BUSY, fileUrl, type VideoDetail } from "@/lib/types";

export default function VideoPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<VideoDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => api<VideoDetail>(`/api/videos/${id}`).then(setData).catch((e) => setError(e.message)), [id]);
  useEffect(() => { load(); }, [load]);
  const status = data?.video.status;
  useEffect(() => {
    if (!status || !BUSY.includes(status)) return;
    const t = setInterval(load, 2500);
    return () => clearInterval(t);
  }, [status, load]);

  if (error) return <Shell><p className="font-bold text-danger" role="alert">{error}</p></Shell>;
  if (!data) return <Shell><div className="h-96 animate-pulse rounded-2xl bg-line/60" /></Shell>;

  const v = data.video;
  const busy = BUSY.includes(v.status);
  const latest = data.renders.find((r) => r.status === "done");
  const failedAt = v.status === "failed" ? (data.renders[0]?.status === "failed" ? 4 : data.plans.length ? 3 : data.transcript ? 3 : 1) : undefined;
  const retry = async () => {
    await api(`/api/videos/${v.id}/${data.transcript?.confirmed ? "revise" : "reanalyze"}`, { method: "POST", json: {} });
    load();
  };
  const remove = async () => {
    if (!window.confirm("این ویدیو و همه‌ی نسخه‌هاش حذف بشه؟")) return;
    await api(`/api/videos/${v.id}`, { method: "DELETE" });
    router.push("/");
  };

  return (
    <Shell>
      <div className="grid gap-10 md:grid-cols-[280px_1fr]">
        <aside className="flex flex-col gap-4">
          <div className="reel-frame mx-auto w-full max-w-[280px]">
            {latest?.outputPath ? (
              <video key={latest.id} src={fileUrl(latest.outputPath)} controls playsInline className="h-full w-full object-cover" />
            ) : (
              <img src={fileUrl(`videos/${v.id}/analysis/keyframes/t001.00.jpg`)} alt="" className={`h-full w-full object-cover ${busy ? "opacity-60" : ""}`}
                onError={(e) => { (e.target as HTMLImageElement).style.visibility = "hidden"; }} />
            )}
          </div>
          <dl className="grid grid-cols-2 gap-y-1 text-sm">
            {v.duration && (<><dt className="text-ink-faint">مدت ویدیوی خام</dt><dd>{clock(v.duration)}</dd></>)}
            {v.analysis?.pauses !== undefined && (<><dt className="text-ink-faint">مکث‌های پیداشده</dt><dd>{faNum(v.analysis.pauses)}</dd></>)}
            {v.analysis?.camera && (<><dt className="text-ink-faint">دوربین</dt><dd>{v.analysis.camera.static ? "ثابت" : "متحرک"}</dd></>)}
            {latest?.duration && (<><dt className="text-ink-faint">مدت ریلز</dt><dd>{clock(latest.duration)}</dd></>)}
          </dl>
          {!busy && <button onClick={remove} className="self-start text-sm font-bold text-ink-faint hover:text-danger">حذف ویدیو</button>}
        </aside>

        <section className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-black">{v.title}</h1>
            <StatusPill status={v.status} />
          </div>
          <div className="mt-4"><StageTrack status={v.status} failedAt={failedAt} /></div>

          {busy && (
            <div className="mt-6 max-w-lg">
              <Progress value={v.progress} busy />
              <p className="mt-2 text-sm text-ink-soft">{v.stage ?? "در صف"} — {faNum(v.progress)}٪</p>
            </div>
          )}

          {v.status === "failed" && (
            <div className="mt-6 rounded-2xl border border-danger/30 bg-danger/5 p-5" role="alert">
              <p className="font-black text-danger">این مرحله انجام نشد</p>
              <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-sm text-ink-soft" dir="ltr">{v.error}</pre>
              <button onClick={retry} className="mt-3 rounded-[10px] bg-ink px-4 py-2.5 font-black text-white hover:bg-violet-deep">دوباره امتحان کن</button>
            </div>
          )}

          <div className="mt-8">
            {v.status === "awaiting_transcript" && data.transcript && (
              <TranscriptEditor videoId={v.id} segments={data.transcript.segments} engine={data.transcript.engine} onConfirmed={load} />
            )}
            {v.status === "ready" && <ResultPanel data={data} onRevised={load} />}
            {busy && data.transcript?.confirmed && (
              <p className="max-w-[62ch] text-ink-soft">متن تأیید شده. کارگردان نقشه‌ی ادیت رو می‌نویسه و بعد رندر شروع می‌شه؛ این صفحه خودش به‌روز می‌شه.</p>
            )}
          </div>
        </section>
      </div>
    </Shell>
  );
}
