"use client";
import { useState } from "react";
import { normalizeSelections, type Selection, type TranscriptSegment } from "@autoreel/shared";
import { api } from "@/lib/api";
import { useCapabilities } from "@/lib/capabilities";
import { clock } from "@/lib/format";
import { OptionPicker } from "./OptionPicker";
import { BriefFields } from "./BriefFields";

/**
 * Everything the director needs before it starts: the transcript (fixed by the creator), the point of view,
 * a description when nobody speaks, and the options that must appear in the reel.
 */
export function ReviewStep({ videoId, segments, engine, initial, onConfirmed }: {
  videoId: string; segments: TranscriptSegment[]; engine: string;
  initial: { pov: string; description: string; options: Array<Selection | string> }; onConfirmed: () => void;
}) {
  const [texts, setTexts] = useState(segments.map((s) => s.text));
  const [dirty, setDirty] = useState<Set<number>>(new Set());
  const [pov, setPov] = useState(initial.pov);
  const [description, setDescription] = useState(initial.description);
  const [options, setOptions] = useState<Selection[]>(() => normalizeSelections(initial.options));
  const caps = useCapabilities();
  const [state, setState] = useState<"idle" | "saving" | "saved" | "confirming">("idle");
  const [error, setError] = useState<string | null>(null);
  const spoken = texts.some((t) => t.trim());
  const needsDescription = !spoken && !description.trim();

  const edit = (i: number, v: string) => { const t = [...texts]; t[i] = v; setTexts(t); setDirty(new Set(dirty).add(i)); setState("idle"); };
  const clearAll = () => { setTexts(texts.map(() => "")); setDirty(new Set(texts.map((_, i) => i))); setState("idle"); };

  const save = async () => {
    setState("saving"); setError(null);
    try {
      if (dirty.size) await api(`/api/videos/${videoId}/transcript`, { method: "PUT", json: { segments: [...dirty].map((i) => ({ index: i, text: texts[i] })) } });
      await api(`/api/videos/${videoId}/brief`, { method: "PUT", json: { pov, description, options } });
      setDirty(new Set()); setState("saved"); return true;
    } catch (e) { setError((e as Error).message); setState("idle"); return false; }
  };
  const confirm = async () => {
    if (needsDescription) { setError("در این ویدیو حرفی نیست. اول یک توضیح کوتاه بنویس که توی ویدیو چه اتفاقی می‌افته."); return; }
    if (!(await save())) return;
    setState("confirming");
    try { await api(`/api/videos/${videoId}/confirm`, { method: "POST", json: { pov, description, options } }); onConfirmed(); }
    catch (e) { setError((e as Error).message); setState("idle"); }
  };

  return (
    <div className="flex flex-col gap-10">
      <section aria-labelledby="tr-title">
        <h2 id="tr-title" className="text-xl font-black">{segments.length ? "متن ویدیو رو چک کن" : "در این ویدیو حرفی شنیده نشد"}</h2>
        {segments.length ? (
          <>
            <p className="mt-1 max-w-[62ch] text-ink-soft">
              زیرنویس‌ها و گرافیک‌ها از روی همین متن ساخته می‌شن. هر کلمه‌ای که اشتباه شنیده شده رو درست کن.
              {engine.includes("local") && " (تشخیص گفتار فعلی مدل محلیه و برای فارسی دقت پایینی داره.)"}
            </p>
            <ol className="mt-5 flex flex-col gap-3">
              {segments.map((s, i) => (
                <li key={i} className="grid grid-cols-[70px_1fr] items-start gap-3">
                  <span className="pt-3 text-sm tabular-nums text-ink-faint">{clock(s.start)}</span>
                  <textarea value={texts[i]} onChange={(e) => edit(i, e.target.value)}
                    rows={Math.max(1, Math.ceil(texts[i].length / 58))}
                    placeholder="این بخش حذف می‌شه"
                    className={`w-full resize-y rounded-[10px] border bg-white px-3 py-2.5 text-[17px] leading-8 outline-none focus:border-violet ${dirty.has(i) ? "border-cap" : "border-line"}`}
                    aria-label={`بخش ${i + 1} از ${clock(s.start)} تا ${clock(s.end)}`} />
                </li>
              ))}
            </ol>
            {spoken && (
              <button type="button" onClick={clearAll} className="mt-3 text-sm font-bold text-ink-faint underline-offset-4 hover:text-ink hover:underline">
                کسی در ویدیو حرف نمی‌زنه؟ کل متن رو پاک کن
              </button>
            )}
          </>
        ) : (
          <p className="mt-1 max-w-[62ch] text-ink-soft">
            پس زیرنویسی از روی حرف ساخته نمی‌شه. پایین‌تر یک توضیح کوتاه بنویس؛ همون متن روی تصویر نمایش داده می‌شه و گرافیک‌ها از روش ساخته می‌شن.
          </p>
        )}
      </section>

      <BriefFields pov={pov} description={description} spoken={spoken}
        onPov={(v) => { setPov(v); setState("idle"); }} onDescription={(v) => { setDescription(v); setState("idle"); }} />

      <section aria-labelledby="opt-title">
        <h2 id="opt-title" className="text-xl font-black">گرافیک‌ها، موشن‌ها و ادیت</h2>
        <div className="mt-3"><OptionPicker value={options} videoId={videoId} caps={caps} onChange={(v) => { setOptions(v); setState("idle"); }} /></div>
      </section>

      <div>
        {error && <p className="mb-4 font-bold text-danger" role="alert">{error}</p>}
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={confirm} disabled={state === "saving" || state === "confirming"}
            className="rounded-[10px] bg-ink px-5 py-3 font-black text-white transition-colors hover:bg-violet-deep disabled:opacity-60">
            {state === "confirming" ? "در حال شروع ادیت…" : "تأیید و شروع ادیت"}
          </button>
          <button onClick={save} disabled={state === "saving"} className="rounded-[10px] border border-line bg-white px-4 py-3 font-bold text-ink disabled:opacity-50">
            {state === "saving" ? "در حال ذخیره…" : "ذخیره"}
          </button>
          {state === "saved" && <span className="text-sm font-bold text-ok">ذخیره شد</span>}
        </div>
      </div>
    </div>
  );
}
