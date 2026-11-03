"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { uploadVideo } from "@/lib/api";
import { faNum } from "@/lib/format";

/** Drop zone shaped like the reel it will become. */
export function UploadFrame({ onUploaded }: { onUploaded?: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [over, setOver] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");

  const send = async (file?: File | null) => {
    if (!file) return;
    if (!file.type.startsWith("video/")) { setError("این فایل ویدیو نیست. یک فایل mp4 یا mov انتخاب کن."); return; }
    setError(null); setProgress(0);
    try {
      const { id } = await uploadVideo(file, title.trim(), setProgress);
      onUploaded?.();
      router.push(`/videos/${id}`);
    } catch (e) {
      setError((e as Error).message); setProgress(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); send(e.dataTransfer.files?.[0]); }}
        className={`reel-frame relative mx-auto flex w-full max-w-[190px] md:max-w-[260px] flex-col items-center justify-center gap-3 px-6 text-center transition-colors ${over ? "bg-violet-deep" : ""}`}
        disabled={progress !== null}
      >
        {progress === null ? (
          <>
            <span className="grid h-14 w-14 place-items-center rounded-full bg-cap text-ink">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden><path d="M12 16V4M6 10l6-6 6 6M5 20h14" /></svg>
            </span>
            <span className="text-lg font-black text-white">ویدیوی خام رو اینجا رها کن</span>
            <span className="text-sm leading-6 text-white/70">یا کلیک کن و انتخابش کن. عمودی، تا ۲ دقیقه، mp4 یا mov.</span>
          </>
        ) : (
          <>
            <span className="text-4xl font-black text-cap">{faNum(Math.round(progress * 100))}٪</span>
            <span className="text-sm text-white/80">{progress < 1 ? "در حال آپلود…" : "در حال ثبت…"}</span>
            <span className="absolute inset-x-6 bottom-8 h-1.5 overflow-hidden rounded-full bg-white/20"><span className="block h-full bg-cap transition-[width]" style={{ width: `${progress * 100}%` }} /></span>
          </>
        )}
      </button>
      <input ref={input} type="file" accept="video/*" hidden onChange={(e) => send(e.target.files?.[0])} />
      <label className="mx-auto w-full max-w-[260px] text-sm text-ink-soft">
        اسم ویدیو (اختیاری)
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="مثلاً معرفی محصول"
          className="mt-1 w-full rounded-[10px] border border-line bg-white px-3 py-2 text-[15px] text-ink outline-none focus:border-violet" />
      </label>
      {error && <p className="mx-auto max-w-[260px] text-sm font-bold text-danger" role="alert">{error}</p>}
    </div>
  );
}
