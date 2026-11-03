"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { uploadVideo } from "@/lib/api";
import { clock, faNum } from "@/lib/format";

interface Staged { file: File; url: string; duration: number | null }
const MAX_FILES = 10;
const MAX_SECONDS = 120;

/**
 * Drop zone shaped like the reel it will become. One or more clips can be added; they are joined in the order
 * shown here. The point of view can be written before uploading.
 */
export function UploadFrame({ onUploaded }: { onUploaded?: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [over, setOver] = useState(false);
  const [clips, setClips] = useState<Staged[]>([]);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [pov, setPov] = useState("");
  useEffect(() => () => clips.forEach((c) => URL.revokeObjectURL(c.url)), []); // eslint-disable-line react-hooks/exhaustive-deps

  const add = (list?: FileList | null) => {
    if (!list?.length) return;
    const files = [...list];
    const bad = files.find((f) => !f.type.startsWith("video/"));
    if (bad) { setError(`«${bad.name}» ویدیو نیست. فایل mp4 یا mov انتخاب کن.`); return; }
    if (clips.length + files.length > MAX_FILES) { setError(`حداکثر ${faNum(MAX_FILES)} ویدیو رو می‌شه با هم چسبوند.`); return; }
    setError(null);
    const staged = files.map((file) => ({ file, url: URL.createObjectURL(file), duration: null as number | null }));
    setClips((c) => [...c, ...staged]);
    // read each clip's length from its metadata
    staged.forEach((s) => {
      const v = document.createElement("video");
      v.preload = "metadata"; v.src = s.url;
      v.onloadedmetadata = () => setClips((c) => c.map((x) => (x.url === s.url ? { ...x, duration: v.duration } : x)));
    });
  };
  const move = (i: number, d: -1 | 1) => setClips((c) => { const n = [...c]; [n[i], n[i + d]] = [n[i + d], n[i]]; return n; });
  const remove = (i: number) => setClips((c) => { URL.revokeObjectURL(c[i].url); return c.filter((_, k) => k !== i); });
  const total = clips.reduce((t, c) => t + (c.duration ?? 0), 0);
  const tooLong = total > MAX_SECONDS;

  const send = async () => {
    if (!clips.length || tooLong) return;
    setError(null); setProgress(0);
    try {
      const { id } = await uploadVideo(clips.map((c) => c.file), title.trim(), pov.trim(), setProgress);
      onUploaded?.();
      router.push(`/videos/${id}`);
    } catch (e) {
      setError((e as Error).message); setProgress(null);
    }
  };

  const field = "mt-1 w-full rounded-[10px] border border-line bg-white px-3 py-2 text-[15px] text-ink outline-none focus:border-violet";
  return (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); add(e.dataTransfer.files); }}
        className={`reel-frame relative mx-auto flex w-full max-w-[190px] md:max-w-[260px] flex-col items-center justify-center gap-3 px-6 text-center transition-colors ${over ? "bg-violet-deep" : ""}`}
        disabled={progress !== null}
        aria-label={clips.length ? "افزودن ویدیوی دیگه" : "انتخاب ویدیو"}
      >
        {clips.length > 0 && progress === null && (
          <video src={clips[0].url} muted playsInline preload="metadata" className="absolute inset-0 h-full w-full object-cover opacity-45" aria-hidden />
        )}
        {progress === null ? (
          <span className="relative flex flex-col items-center gap-3">
            <span className="grid h-14 w-14 place-items-center rounded-full bg-cap text-ink">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
                {clips.length ? <path d="M12 5v14M5 12h14" /> : <path d="M12 16V4M6 10l6-6 6 6M5 20h14" />}
              </svg>
            </span>
            <span className="text-lg font-black text-white">{clips.length ? "ویدیوی دیگه‌ای اضافه کن" : "ویدیوی خام رو اینجا رها کن"}</span>
            <span className="text-sm leading-6 text-white/75">
              {clips.length ? "به ترتیب فهرست پایین به هم چسبونده می‌شن." : "یا کلیک کن. یک یا چند ویدیو، عمودی، در مجموع تا ۲ دقیقه."}
            </span>
          </span>
        ) : (
          <>
            <span className="text-4xl font-black text-cap">{faNum(Math.round(progress * 100))}٪</span>
            <span className="text-sm text-white/80">{progress < 1 ? "در حال آپلود…" : "در حال ثبت…"}</span>
            <span className="absolute inset-x-6 bottom-8 h-1.5 overflow-hidden rounded-full bg-white/20"><span className="block h-full bg-cap transition-[width]" style={{ width: `${progress * 100}%` }} /></span>
          </>
        )}
      </button>
      <input ref={input} type="file" accept="video/*" multiple hidden onChange={(e) => { add(e.target.files); e.target.value = ""; }} />

      {clips.length > 0 && (
        <div className="mx-auto w-full max-w-[260px]">
          <ol className="flex flex-col divide-y divide-line overflow-hidden rounded-xl border border-line bg-white" aria-label="ترتیب ویدیوها">
            {clips.map((c, i) => (
              <li key={c.url} className="flex items-center gap-2 px-2.5 py-2 text-sm">
                <span className="w-5 shrink-0 text-center font-black text-ink-faint">{faNum(i + 1)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-bold [font-feature-settings:normal]" dir="ltr">{c.file.name}</span>
                  <span className="block text-xs text-ink-faint">{c.duration ? clock(c.duration) : "…"}</span>
                </span>
                {clips.length > 1 && (
                  <span className="flex shrink-0">
                    <button type="button" onClick={() => move(i, -1)} disabled={i === 0 || progress !== null} className="grid h-7 w-7 place-items-center rounded-md text-ink-soft hover:bg-paper disabled:opacity-25" aria-label={`ویدیوی ${i + 1} یکی بالاتر`}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden><path d="M6 15l6-6 6 6" /></svg>
                    </button>
                    <button type="button" onClick={() => move(i, 1)} disabled={i === clips.length - 1 || progress !== null} className="grid h-7 w-7 place-items-center rounded-md text-ink-soft hover:bg-paper disabled:opacity-25" aria-label={`ویدیوی ${i + 1} یکی پایین‌تر`}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden><path d="M6 9l6 6 6-6" /></svg>
                    </button>
                  </span>
                )}
                <button type="button" onClick={() => remove(i)} disabled={progress !== null} className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-ink-faint hover:bg-paper hover:text-danger disabled:opacity-25" aria-label={`حذف ${c.file.name}`}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg>
                </button>
              </li>
            ))}
          </ol>
          <p className={`mt-1.5 text-xs ${tooLong ? "font-bold text-danger" : "text-ink-faint"}`}>
            {clips.length > 1 ? `${faNum(clips.length)} ویدیو، ` : ""}مجموع {clock(total)}{tooLong ? " — بیشتر از ۲ دقیقه‌ست؛ یکی رو حذف کن یا کوتاه‌ترش کن." : ""}
          </p>
        </div>
      )}

      <label className="mx-auto w-full max-w-[260px] text-sm text-ink-soft">
        اسم ویدیو (اختیاری)
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="مثلاً معرفی محصول" className={field} />
      </label>
      {clips.length > 0 && (
        <>
          <label className="mx-auto w-full max-w-[260px] text-sm text-ink-soft">
            زاویه‌ی دید (اختیاری)
            <textarea value={pov} onChange={(e) => setPov(e.target.value)} rows={3} maxLength={2000}
              placeholder="این ویدیو قراره بیننده رو به چی برسونه؟" className={`${field} resize-y leading-6`} />
          </label>
          <button type="button" onClick={send} disabled={progress !== null || tooLong}
            className="mx-auto w-full max-w-[260px] rounded-[10px] bg-ink px-4 py-3 font-black text-white transition-colors hover:bg-violet-deep disabled:opacity-50">
            {clips.length > 1 ? `آپلود و چسبوندن ${faNum(clips.length)} ویدیو` : "آپلود و شروع تحلیل"}
          </button>
        </>
      )}
      {error && <p className="mx-auto max-w-[260px] text-sm font-bold text-danger" role="alert">{error}</p>}
    </div>
  );
}
