"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { faNum, when } from "@/lib/format";
import { fileUrl, type VideoDetail } from "@/lib/types";

export function ResultPanel({ data, onRevised }: { data: VideoDetail; onRevised: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const done = data.renders.filter((r) => r.status === "done");
  const latest = done[0];
  const plan = data.plans[0];
  const warnings = plan?.validation?.warnings ?? [];

  const revise = async () => {
    setBusy(true); setError(null);
    try { await api(`/api/videos/${data.video.id}/revise`, { method: "POST", json: { note } }); setNote(""); onRevised(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="flex flex-col gap-8">
      {latest && (
        <section>
          <h2 className="text-xl font-black">ریلز آماده‌ست</h2>
          <p className="mt-1 text-ink-soft">
            نسخه‌ی {faNum(plan?.version ?? 1)} — کارگردان: {plan?.source === "claude" ? "Claude" : "قاعده‌محور"}
            {latest.elapsedS ? ` — رندر در ${faNum(Math.round(latest.elapsedS))} ثانیه` : ""}
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <a href={fileUrl(latest.outputPath!)} download className="rounded-[10px] bg-ink px-5 py-3 font-black text-white hover:bg-violet-deep">دانلود ویدیو</a>
            {plan && <a href={`/api/videos/${data.video.id}/plans/${plan.version}`} target="_blank" className="rounded-[10px] border border-line bg-white px-4 py-3 font-bold">نقشه‌ی ادیت (JSON)</a>}
          </div>
        </section>
      )}

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
        <h3 className="font-black">نسخه‌ی جدید بساز</h3>
        <p className="mt-1 text-sm text-ink-soft">
          بنویس چی رو می‌خوای عوض کنی (مثلاً «گرافیک کمتر» یا «قلاب اول قوی‌تر»). کارگردان فعلی قاعده‌محوره و یادداشت رو فقط ذخیره می‌کنه؛ کارگردان Claude اعمالش می‌کنه.
        </p>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3}
          className="mt-3 w-full rounded-[10px] border border-line px-3 py-2 outline-none focus:border-violet" />
        {error && <p className="mt-2 text-sm font-bold text-danger" role="alert">{error}</p>}
        <button onClick={revise} disabled={busy} className="mt-3 rounded-[10px] bg-violet px-4 py-2.5 font-black text-white hover:bg-violet-deep disabled:opacity-60">
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
