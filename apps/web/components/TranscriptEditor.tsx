"use client";
import { useState } from "react";
import type { TranscriptSegment } from "@autoreel/shared";
import { api } from "@/lib/api";
import { clock } from "@/lib/format";

/** One row per spoken segment. Fixing a word keeps its timing (time is spread over the edited words). */
export function TranscriptEditor({ videoId, segments, engine, onConfirmed }: { videoId: string; segments: TranscriptSegment[]; engine: string; onConfirmed: () => void }) {
  const [texts, setTexts] = useState(segments.map((s) => s.text));
  const [dirty, setDirty] = useState<Set<number>>(new Set());
  const [state, setState] = useState<"idle" | "saving" | "saved" | "confirming">("idle");
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!dirty.size) return true;
    setState("saving"); setError(null);
    try {
      await api(`/api/videos/${videoId}/transcript`, { method: "PUT", json: { segments: [...dirty].map((i) => ({ index: i, text: texts[i] })) } });
      setDirty(new Set()); setState("saved"); return true;
    } catch (e) { setError((e as Error).message); setState("idle"); return false; }
  };
  const confirm = async () => {
    if (!(await save())) return;
    setState("confirming");
    try { await api(`/api/videos/${videoId}/confirm`, { method: "POST" }); onConfirmed(); }
    catch (e) { setError((e as Error).message); setState("idle"); }
  };

  return (
    <section aria-labelledby="tr-title">
      <h2 id="tr-title" className="text-xl font-black">متن ویدیو رو چک کن</h2>
      <p className="mt-1 max-w-[62ch] text-ink-soft">
        زیرنویس‌ها و گرافیک‌ها از روی همین متن ساخته می‌شن. هر کلمه‌ای که اشتباه شنیده شده رو درست کن، بعد متن رو تأیید کن.
        {engine.includes("local") && " (تشخیص گفتار فعلی مدل محلیه و برای فارسی دقت پایینی داره.)"}
      </p>
      <ol className="mt-5 flex flex-col gap-3">
        {segments.map((s, i) => (
          <li key={i} className="grid grid-cols-[70px_1fr] items-start gap-3">
            <span className="pt-3 text-sm tabular-nums text-ink-faint">{clock(s.start)}</span>
            <textarea
              value={texts[i]}
              onChange={(e) => { const t = [...texts]; t[i] = e.target.value; setTexts(t); setDirty(new Set(dirty).add(i)); setState("idle"); }}
              rows={Math.max(1, Math.ceil(texts[i].length / 58))}
              className={`w-full resize-y rounded-[10px] border bg-white px-3 py-2.5 text-[17px] leading-8 outline-none focus:border-violet ${dirty.has(i) ? "border-cap" : "border-line"}`}
              aria-label={`بخش ${i + 1} از ${clock(s.start)} تا ${clock(s.end)}`}
            />
          </li>
        ))}
      </ol>
      {error && <p className="mt-4 font-bold text-danger" role="alert">{error}</p>}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button onClick={confirm} disabled={state === "saving" || state === "confirming"}
          className="rounded-[10px] bg-ink px-5 py-3 font-black text-white transition-colors hover:bg-violet-deep disabled:opacity-60">
          {state === "confirming" ? "در حال شروع ادیت…" : "تأیید متن و شروع ادیت"}
        </button>
        <button onClick={save} disabled={!dirty.size || state === "saving"}
          className="rounded-[10px] border border-line bg-white px-4 py-3 font-bold text-ink disabled:opacity-50">
          {state === "saving" ? "در حال ذخیره…" : "ذخیره‌ی متن"}
        </button>
        {state === "saved" && <span className="text-sm font-bold text-ok">ذخیره شد</span>}
      </div>
    </section>
  );
}
