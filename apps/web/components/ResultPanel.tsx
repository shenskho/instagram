"use client";
import { useState } from "react";
import { EDIT_OPTIONS, optionLabel, normalizeSelections, type Selection, type UsageItem } from "@autoreel/shared";
import { api } from "@/lib/api";
import { clock, faNum, when } from "@/lib/format";
import { fileUrl, type VideoDetail } from "@/lib/types";
import { useCapabilities } from "@/lib/capabilities";
import { OptionPicker } from "./OptionPicker";
import { BriefFields } from "./BriefFields";

/** Jump the reel player (in the side column) to an output time. */
function seek(t: number) {
  const el = document.getElementById("reel-player") as HTMLVideoElement | null;
  if (!el) return;
  el.currentTime = Math.max(0, t - 0.3);
  el.play().catch(() => undefined);
  el.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

export function ResultPanel({ data, onRevised }: { data: VideoDetail; onRevised: () => void }) {
  const v = data.video;
  const [note, setNote] = useState("");
  const [pov, setPov] = useState(v.pov);
  const [description, setDescription] = useState(v.description);
  const [options, setOptions] = useState<Selection[]>(() => normalizeSelections(v.options));
  const caps = useCapabilities();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const done = data.renders.filter((r) => r.status === "done");
  const latest = done[0];
  const plan = data.plans[0];
  const warnings = plan?.validation?.warnings ?? [];
  const spoken = !!data.transcript?.segments.some((s) => s.text.trim());

  const revise = async () => {
    setBusy(true); setError(null);
    try { await api(`/api/videos/${v.id}/revise`, { method: "POST", json: { note, pov, description, options } }); setNote(""); onRevised(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="flex flex-col gap-10">
      {latest && (
        <section>
          <h2 className="text-xl font-black">ریلز آماده‌ست</h2>
          <p className="mt-1 text-ink-soft">
            نسخه‌ی {faNum(plan?.version ?? 1)} — کارگردان: {plan?.source === "claude" ? "Claude" : "قاعده‌محور"}
            {latest.elapsedS ? ` — رندر در ${faNum(Math.round(latest.elapsedS))} ثانیه` : ""}
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <a href={fileUrl(latest.outputPath!)} download className="rounded-[10px] bg-ink px-5 py-3 font-black text-white hover:bg-violet-deep">دانلود ویدیو</a>
            {plan && <a href={`/api/videos/${v.id}/plans/${plan.version}`} target="_blank" className="rounded-[10px] border border-line bg-white px-4 py-3 font-bold">نقشه‌ی ادیت (JSON)</a>}
          </div>
        </section>
      )}

      {plan && (plan.usage.length > 0 || plan.missing.length > 0) && <UsageList usage={plan.usage} missing={plan.missing} notes={plan.notes ?? []} />}

      {latest?.qcPath && (
        <section>
          <h3 className="mb-2 font-black">همه‌ی لحظه‌های گرافیکی در یک نگاه</h3>
          <img src={fileUrl(latest.qcPath)} alt="برگه‌ی بازبینی: یک فریم از هر گرافیک و هر بخش" className="w-full rounded-xl border border-line" />
        </section>
      )}

      {!!warnings.length && (
        <section>
          <h3 className="mb-2 font-black">نکته‌هایی که بررسی خودکار پیدا کرد</h3>
          <ul className="list-disc space-y-1 ps-5 text-sm text-ink-soft" dir="ltr">
            {warnings.map((w, i) => <li key={i} className="text-left">{w.where}: {w.msg}</li>)}
          </ul>
        </section>
      )}

      <section className="rounded-2xl border border-line bg-white p-5">
        <h3 className="text-lg font-black">نسخه‌ی جدید بساز</h3>
        <p className="mt-1 text-sm text-ink-soft">گزینه‌ها، زاویه‌ی دید یا توضیح رو عوض کن و نسخه‌ی جدید بساز. نسخه‌ی فعلی سر جاش می‌مونه.</p>
        <div className="mt-6"><OptionPicker value={options} onChange={setOptions} videoId={v.id} caps={caps} /></div>
        <div className="mt-8"><BriefFields pov={pov} description={description} spoken={spoken} onPov={setPov} onDescription={setDescription} /></div>
        <label className="mt-6 block">
          <span className="font-black">یادداشت برای کارگردان</span> <span className="text-sm text-ink-faint">اختیاری</span>
          <span className="mt-1 block text-sm text-ink-soft">مثلاً «قلاب اول قوی‌تر». کارگردان قاعده‌محور یادداشت رو فقط ذخیره می‌کنه؛ کارگردان Claude اعمالش می‌کنه.</span>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2}
            className="mt-2 w-full rounded-[10px] border border-line px-3 py-2 outline-none focus:border-violet" />
        </label>
        {error && <p className="mt-3 text-sm font-bold text-danger" role="alert">{error}</p>}
        <button onClick={revise} disabled={busy} className="mt-4 rounded-[10px] bg-violet px-5 py-3 font-black text-white hover:bg-violet-deep disabled:opacity-60">
          {busy ? "در حال ارسال…" : "ساخت نسخه‌ی جدید"}
        </button>
      </section>

      {done.length > 1 && (
        <section>
          <h3 className="mb-2 font-black">نسخه‌های قبلی</h3>
          <ul className="space-y-1 text-sm">
            {done.slice(1).map((r) => (
              <li key={r.id}><a className="font-bold text-violet-deep underline-offset-4 hover:underline" href={fileUrl(r.outputPath!)}>{when(r.createdAt)}</a></li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** Every option in this reel, with the moments it appears; clicking a moment plays the reel from there. */
function UsageList({ usage, missing, notes }: { usage: UsageItem[]; missing: string[]; notes: string[] }) {
  const order = EDIT_OPTIONS.map((o) => o.id);
  // an option the creator picked is listed under their choices with every moment it shows up,
  // including the ones the director added on its own. Each distinct type («ساحل ← فضا», «قلب») gets its own row.
  const picked = new Set(usage.filter((u) => !u.auto).map((u) => u.id));
  const group = (mine: boolean) => {
    const by = new Map<string, { id: string; label: string; times: number[] }>();
    for (const u of usage) {
      if (picked.has(u.id) !== mine) continue;
      const label = u.label ?? optionLabel(u.id);
      const k = `${u.id}|${label}`;
      const row = by.get(k) ?? { id: u.id, label, times: [] };
      row.times.push(u.out); by.set(k, row);
    }
    return [...by.values()].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id) || a.times[0] - b.times[0]);
  };
  const mine = group(true), auto = group(false);
  const Row = ({ label, times }: { label: string; times: number[] }) => (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2">
      <span className="min-w-[9rem] font-bold">{label}</span>
      <span className="flex flex-wrap gap-1.5">
        {times.map((t, i) => (
          <button key={i} type="button" onClick={() => seek(t)} aria-label={`${label} در ${clock(t)} — پخش از همین‌جا`}
            className="rounded-md border border-line bg-white px-2 py-0.5 text-sm tabular-nums hover:border-ink">
            {clock(t)}
          </button>
        ))}
      </span>
    </li>
  );
  return (
    <section>
      <h3 className="font-black">در این ریلز</h3>
      <p className="mt-1 text-sm text-ink-soft">روی هر زمان بزن تا ریلز از همون لحظه پخش بشه.</p>
      {notes.length > 0 && (
        <ul className="mt-3 list-disc space-y-0.5 rounded-xl bg-violet-wash p-3 ps-7 text-sm font-bold text-violet-deep">{notes.map((n) => <li key={n}>{n}</li>)}</ul>
      )}
      {mine.length > 0 && (
        <>
          <h4 className="mt-4 text-sm font-black text-ink-soft">انتخاب‌های تو</h4>
          <ul className="divide-y divide-line">{mine.map((r) => <Row key={r.id + r.label} label={r.label} times={r.times} />)}</ul>
        </>
      )}
      {missing.length > 0 && (
        <p className="mt-2 text-sm font-bold text-danger" role="alert">جا نشد: {missing.map(optionLabel).join("، ")}. ویدیو برای این گزینه‌ها خیلی کوتاهه.</p>
      )}
      {auto.length > 0 && (
        <>
          <h4 className="mt-4 text-sm font-black text-ink-soft">اضافه‌شده توسط کارگردان</h4>
          <ul className="divide-y divide-line">{auto.map((r) => <Row key={r.id + r.label} label={r.label} times={r.times} />)}</ul>
        </>
      )}
    </section>
  );
}
