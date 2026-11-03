"use client";
import { useEffect, useState } from "react";
import type { StyleSettings } from "@autoreel/shared";
import { Shell } from "@/components/Shell";
import { api } from "@/lib/api";
import { faNum } from "@/lib/format";

const DENSITY: Array<{ v: StyleSettings["graphicsDensity"]; label: string; hint: string }> = [
  { v: "low", label: "کم", hint: "حداکثر هر ۶ ثانیه یک گرافیک" },
  { v: "normal", label: "معمولی", hint: "حدود هر ۳ تا ۴ ثانیه" },
  { v: "high", label: "زیاد", hint: "پرتحرک، هر ۲ ثانیه" },
];

export default function Settings() {
  const [s, setS] = useState<StyleSettings | null>(null);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api<StyleSettings>("/api/settings/style").then(setS).catch((e) => setError(e.message)); }, []);
  const up = <K extends keyof StyleSettings>(k: K, val: StyleSettings[K]) => { setS((p) => (p ? { ...p, [k]: val } : p)); setState("idle"); };
  const save = async () => {
    if (!s) return;
    setState("saving"); setError(null);
    try { setS(await api<StyleSettings>("/api/settings/style", { method: "PUT", json: s })); setState("saved"); }
    catch (e) { setError((e as Error).message); setState("idle"); }
  };
  if (!s) return <Shell>{error ? <p className="text-danger">{error}</p> : <div className="h-96 animate-pulse rounded-2xl bg-line/60" />}</Shell>;

  const field = "mt-1 w-full rounded-[10px] border border-line bg-white px-3 py-2.5 text-[15px] outline-none focus:border-violet";
  return (
    <Shell>
      <div className="max-w-2xl">
        <h1 className="text-2xl font-black">سبک پیج</h1>
        <p className="mt-1 text-ink-soft">این قانون‌ها روی همه‌ی ویدیوهای بعدی اعمال می‌شن. ویدیوهایی که قبلاً ساخته شدن تغییر نمی‌کنن، مگر نسخه‌ی جدیدشون رو بسازی.</p>

        <div className="mt-8 flex flex-col gap-6">
          <label className="text-sm font-bold">متن قلاب اول ویدیو
            <input className={field} value={s.hookText} maxLength={80} onChange={(e) => up("hookText", e.target.value)} />
            <span className="mt-1 block font-normal text-ink-faint">با حروف درشت در ۲ ثانیه‌ی اول نمایش داده می‌شه. خالی بذاری، قلابی اضافه نمی‌شه.</span>
          </label>
          <label className="text-sm font-bold">سؤال آخر ویدیو
            <input className={field} value={s.ctaText} maxLength={80} onChange={(e) => up("ctaText", e.target.value)} />
            <span className="mt-1 block font-normal text-ink-faint">سؤال مشخص بیشتر کامنت می‌گیره، مثلاً «تو بودی پس‌زمینه‌ت رو کجا می‌بردی؟»</span>
          </label>

          <fieldset>
            <legend className="text-sm font-bold">تعداد گرافیک‌ها</legend>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {DENSITY.map((d) => (
                <button key={d.v} type="button" onClick={() => up("graphicsDensity", d.v)} aria-pressed={s.graphicsDensity === d.v}
                  className={`rounded-[10px] border px-3 py-2.5 text-start ${s.graphicsDensity === d.v ? "border-ink bg-ink text-white" : "border-line bg-white"}`}>
                  <span className="block font-black">{d.label}</span>
                  <span className={`block text-xs ${s.graphicsDensity === d.v ? "text-white/70" : "text-ink-faint"}`}>{d.hint}</span>
                </button>
              ))}
            </div>
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            {([["music", "موسیقی پس‌زمینه"], ["grain", "دانه‌ی فیلم (گرین)"], ["progressBar", "نوار پیشرفت پایین ویدیو"]] as const).map(([k, label]) => (
              <label key={k} className="flex items-center gap-3 rounded-[10px] border border-line bg-white px-3 py-3 text-[15px] font-bold">
                <input type="checkbox" checked={s[k]} onChange={(e) => up(k, e.target.checked)} className="h-5 w-5 accent-violet" />
                {label}
              </label>
            ))}
          </div>

          <label className="text-sm font-bold">بلندی موسیقی: {faNum(s.musicGainDb)} دسی‌بل
            <input type="range" min={-40} max={-6} step={1} value={s.musicGainDb} onChange={(e) => up("musicGainDb", Number(e.target.value))} className="mt-2 w-full accent-violet" />
          </label>
          <label className="text-sm font-bold">کوتاه‌ترین مکثی که بریده می‌شه: {faNum(s.minPause)} ثانیه
            <input type="range" min={0.15} max={1.5} step={0.05} value={s.minPause} onChange={(e) => up("minPause", Number(e.target.value))} className="mt-2 w-full accent-violet" />
          </label>
        </div>

        {error && <p className="mt-4 font-bold text-danger" role="alert">{error}</p>}
        <div className="mt-8 flex items-center gap-3">
          <button onClick={save} disabled={state === "saving"} className="rounded-[10px] bg-ink px-5 py-3 font-black text-white hover:bg-violet-deep disabled:opacity-60">
            {state === "saving" ? "در حال ذخیره…" : "ذخیره‌ی سبک"}
          </button>
          {state === "saved" && <span className="text-sm font-bold text-ok">ذخیره شد</span>}
        </div>
      </div>
    </Shell>
  );
}
