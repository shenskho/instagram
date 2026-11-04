"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  EDIT_OPTIONS, OPTION_GROUPS, LOOK_STYLES, isVisible, withDefaults, resolveTheme, describeSelection,
  type EditOption, type Param, type Choice, type Selection, type ParamValue, type Theme,
} from "@autoreel/shared";
import { api, DIRECT_API } from "@/lib/api";
import { faNum } from "@/lib/format";
import { fileUrl, type Capabilities } from "@/lib/types";

/**
 * Edit options as small reel frames. Pointing at one plays a short loop of what it does (rendered by the engine
 * itself); clicking it adds it to the reel and opens its details: type → details, each with its own preview.
 * The bar on top says which look the whole video will have, so every choice is made knowing the result.
 */
export function OptionPicker({ value, onChange, videoId, caps }: {
  value: Selection[]; onChange: (v: Selection[]) => void; videoId: string; caps: Capabilities | null;
}) {
  const [active, setActive] = useState<string | null>(null);
  const byId = useMemo(() => new Map(value.map((s) => [s.id, s])), [value]);
  const theme = useMemo(() => resolveTheme(value), [value]);

  const pick = (id: string) => {
    if (!byId.has(id)) { onChange([...value, { id, params: {} }]); setActive(id); return; }
    setActive(active === id ? null : id);
  };
  const remove = (id: string) => { onChange(value.filter((s) => s.id !== id)); if (active === id) setActive(null); };
  const setParams = (id: string, params: Record<string, ParamValue>) => onChange(value.map((s) => (s.id === id ? { ...s, params } : s)));

  return (
    <div className="flex flex-col gap-7">
      <ThemeBar theme={theme} />
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="max-w-[70ch] text-sm text-ink-soft">
          نشانگر رو روی هر گزینه نگه دار تا ببینی چی کار می‌کنه. با انتخاب هر گزینه، نوع و جزئیاتش باز می‌شه. همه‌ی انتخاب‌ها در ریلز میان و کارگردان هر جا لازم بدونه چیزهای دیگه هم اضافه می‌کنه.
        </p>
        {value.length > 0 && (
          <span className="text-sm font-bold">
            {faNum(value.length)} گزینه انتخاب شد
            <button type="button" onClick={() => { onChange([]); setActive(null); }} className="ms-3 font-bold text-ink-faint underline-offset-4 hover:text-danger hover:underline">پاک کردن همه</button>
          </span>
        )}
      </div>
      {OPTION_GROUPS.map((g) => {
        const opts = EDIT_OPTIONS.filter((o) => o.group === g.id);
        const open = opts.find((o) => o.id === active && byId.has(o.id));
        return (
          <fieldset key={g.id}>
            <legend className="font-black">{g.label} <span className="text-sm font-normal text-ink-faint">{g.hint}</span></legend>
            <div className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
              {opts.map((o) => (
                <OptionCard key={o.id} o={o} sel={byId.get(o.id)} open={o.id === active} onClick={() => pick(o.id)} />
              ))}
            </div>
            {open && (
              <OptionDetails key={open.id} o={open} sel={byId.get(open.id)!} theme={theme} videoId={videoId} caps={caps}
                onParams={(p) => setParams(open.id, p)} onRemove={() => remove(open.id)} onClose={() => setActive(null)} />
            )}
          </fieldset>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ theme
function ThemeBar({ theme }: { theme: Theme }) {
  const name = LOOK_STYLES[theme.look];
  const where = theme.scope === "background" ? "فقط پس‌زمینه" : theme.scope === "subject" ? "فقط خودت" : "کل تصویر";
  return (
    <div className="rounded-2xl border border-line bg-white p-4" role="status" aria-live="polite">
      <p className="font-black">
        سبک این ویدیو: <span className="cap">{name}</span>
        {theme.look !== "natural" && <span className="ms-2 text-sm font-bold text-ink-soft">روی {where}</span>}
      </p>
      <p className="mt-1 max-w-[72ch] text-sm text-ink-soft">
        {theme.look === "natural"
          ? "تصویر واقعی می‌مونه. اگه «سبک تصویر» یا یک محیط آماده انتخاب کنی، کل ویدیو با همون هماهنگ می‌شه."
          : theme.from === "scene" && theme.scope === "whole"
            ? "محیط آماده‌ای که انتخاب کردی نقاشیه، برای همین کل ویدیو و خودت هم همین سبک می‌شین. اگه می‌خوای خودت واقعی بمونی، در «تغییر محیط پشت سر» گزینه‌ی «فقط پس‌زمینه» رو بزن."
            : "گرافیک‌ها، زیرنویس‌ها و ترنزیشن‌ها هم با همین سبک هماهنگ می‌شن."}
      </p>
      {theme.notes.length > 0 && (
        <ul className="mt-2 list-disc space-y-0.5 ps-5 text-sm font-bold text-ink">{theme.notes.map((n) => <li key={n}>{n}</li>)}</ul>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ one card
function Preview({ name, className, active }: { name: string; className?: string; active?: boolean }) {
  const vid = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = vid.current;
    if (!v) return;
    if (active) { v.currentTime = 0; v.play().catch(() => undefined); } else { v.pause(); v.currentTime = 0; }
  }, [active, name]);
  return (
    <video ref={vid} src={`/previews/${name}.mp4`} poster={`/previews/${name}.jpg`} muted loop playsInline preload="none"
      className={className ?? "h-full w-full object-cover"} aria-hidden />
  );
}

function OptionCard({ o, sel, open, onClick }: { o: EditOption; sel?: Selection; open: boolean; onClick: () => void }) {
  const [hover, setHover] = useState(false);
  const on = !!sel;
  const summary = sel ? describeSelection(sel).replace(`${o.label}: `, "") : "";
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-expanded={on ? open : undefined}
      title={o.hint}
      onClick={onClick}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} onFocus={() => setHover(true)} onBlur={() => setHover(false)}
      onTouchStart={() => setHover(true)}
      className="group flex flex-col gap-2 text-start"
    >
      <span className={`relative block aspect-[9/16] w-full overflow-hidden rounded-[14px] bg-ink transition-shadow ${open ? "shadow-[0_0_0_3px_var(--color-violet)]" : on ? "shadow-[0_0_0_3px_var(--color-ink)]" : "shadow-[0_0_0_1px_var(--color-line)] group-hover:shadow-[0_0_0_2px_var(--color-violet)]"}`}>
        <Preview name={o.preview} active={hover} />
        <span className={`absolute end-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full border-2 transition-colors ${on ? "border-ink bg-cap text-ink" : "border-white/80 bg-black/25 text-transparent"}`} aria-hidden>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
        </span>
      </span>
      <span className="block leading-5">
        <span className={`block text-[14px] ${on ? "font-black" : "font-bold"}`}>{o.label}</span>
        <span className={`mt-0.5 block text-[12px] leading-[18px] ${on && summary ? "font-bold text-violet-deep" : "text-ink-faint"}`}>{on && summary ? summary : o.hint}</span>
      </span>
    </button>
  );
}

// ------------------------------------------------------------------ details: type → details
function OptionDetails({ o, sel, theme, videoId, caps, onParams, onRemove, onClose }: {
  o: EditOption; sel: Selection; theme: Theme; videoId: string; caps: Capabilities | null;
  onParams: (p: Record<string, ParamValue>) => void; onRemove: () => void; onClose: () => void;
}) {
  const values = withDefaults(sel);
  const [hoverPv, setHoverPv] = useState<string | null>(null);
  const [genImg, setGenImg] = useState<string | null>(null);
  // the preview of what is picked now: the last choice (in param order) that has its own clip
  const pickedPv = useMemo(() => {
    let pv = o.preview;
    for (const p of o.params) {
      if (!isVisible(p.when, values) || (p.kind !== "one" && p.kind !== "many")) continue;
      const v = values[p.id];
      const id = Array.isArray(v) ? v[0] : v;
      const ch = p.choices.find((c) => c.id === id);
      if (ch?.preview && !ch.preview.startsWith("gen-")) pv = ch.preview;
    }
    return pv;
  }, [o, values]);
  const shown = hoverPv ?? pickedPv;
  const set = (id: string, v: ParamValue) => {
    const next: Record<string, ParamValue> = { ...sel.params, [id]: v };
    // a param whose choices depend on this one starts again from its first visible choice
    for (const p of o.params) if (p.kind === "one" && p.choices.some((c) => c.when?.param === id)) delete next[p.id];
    onParams(next);
  };
  const visible = o.params.filter((p) => isVisible(p.when, values));
  return (
    <section className="mt-4 rounded-2xl border border-line bg-white p-4 sm:p-5" aria-label={`جزئیات ${o.label}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-black">{o.label}</h3>
          <p className="text-sm text-ink-soft">{o.hint}</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="rounded-[10px] border border-line px-3 py-1.5 text-sm font-bold">بستن</button>
          <button type="button" onClick={onRemove} className="rounded-[10px] border border-line px-3 py-1.5 text-sm font-bold text-danger hover:border-danger">حذف از ریلز</button>
        </div>
      </div>
      <div className="mt-4 grid gap-5 sm:grid-cols-[180px_1fr]">
        <div className="mx-auto w-[150px] sm:w-[180px]">
          <div className="aspect-[9/16] overflow-hidden rounded-[14px] bg-ink">
            {genImg ? <img src={fileUrl(genImg)} alt="محیطی که ساخته شد" className="h-full w-full object-cover" />
              : <Preview key={shown} name={shown} active />}
          </div>
          <p className="mt-1.5 text-center text-[12px] text-ink-faint">{genImg ? "محیطی که ساخته شد" : "پیش‌نمایش روی ویدیوی نمونه"}</p>
        </div>
        <div className="flex min-w-0 flex-col gap-5">
          {!visible.length && <p className="text-sm text-ink-soft">این گزینه تنظیم دیگه‌ای نداره؛ کارگردان بهترین جا رو براش انتخاب می‌کنه.</p>}
          {visible.map((p) => (
            <ParamControl key={p.id} p={p} value={values[p.id]} values={values} caps={caps} theme={theme} videoId={videoId}
              onChange={(v) => set(p.id, v)} onHover={setHoverPv} onGenerated={setGenImg} />
          ))}
        </div>
      </div>
    </section>
  );
}

const chip = (on: boolean, locked = false) =>
  `inline-flex min-h-10 items-center gap-2 rounded-[10px] border px-3 py-1.5 text-[14px] font-bold transition-colors ${
    locked ? "cursor-not-allowed border-dashed border-line text-ink-faint" : on ? "border-ink bg-cap text-ink" : "border-line bg-white hover:border-ink"}`;

function ParamControl({ p, value, values, caps, theme, videoId, onChange, onHover, onGenerated }: {
  p: Param; value: ParamValue; values: Record<string, ParamValue>; caps: Capabilities | null; theme: Theme; videoId: string;
  onChange: (v: ParamValue) => void; onHover: (pv: string | null) => void; onGenerated: (path: string | null) => void;
}) {
  const [why, setWhy] = useState<string | null>(null);
  const gen = caps?.imagegen;
  const blocked = (c: Choice): string | undefined => c.locked ?? (c.needs === "imagegen" && !gen?.available ? imagegenReason(gen) : undefined);
  const label = (
    <div className="mb-2">
      <span className="font-black">{p.label}</span>
      {p.hint && <span className="mt-0.5 block text-sm text-ink-soft">{p.hint}</span>}
    </div>
  );
  if (p.kind === "one") {
    const choices = p.choices.filter((c) => isVisible(c.when, values));
    return (
      <div role="radiogroup" aria-label={p.label}>
        {label}
        <div className="flex flex-wrap gap-2">
          {choices.map((c) => {
            const lock = blocked(c);
            const on = value === c.id;
            const text = c.id === "auto" && p.id.includes("style") ? `${c.label} (${LOOK_STYLES[theme.look]})` : c.label;
            return (
              <button key={c.id} type="button" role="radio" aria-checked={on} aria-disabled={!!lock}
                onClick={() => (lock ? setWhy(lock) : (setWhy(null), onChange(c.id)))}
                onMouseEnter={() => c.preview && !c.preview.startsWith("gen-") && onHover(c.preview)} onMouseLeave={() => onHover(null)}
                onFocus={() => c.preview && !c.preview.startsWith("gen-") && onHover(c.preview)} onBlur={() => onHover(null)}
                title={lock ?? c.hint} className={chip(on, !!lock)}>
                {c.preview && !c.preview.startsWith("gen-") && <img src={`/previews/${c.preview}.jpg`} alt="" className="h-8 w-[18px] rounded-[4px] object-cover" loading="lazy" onError={(e) => { e.currentTarget.style.display = "none"; }} />}
                {text}
                {lock && <span className="text-[11px] font-bold">قفل</span>}
              </button>
            );
          })}
        </div>
        {why && <p className="mt-2 max-w-[62ch] text-sm font-bold text-ink-soft" role="note">{why}</p>}
      </div>
    );
  }
  if (p.kind === "many") {
    const cur = Array.isArray(value) ? value : [];
    const toggle = (id: string) => onChange(cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= p.max ? cur : [...cur, id]);
    const customs = cur.filter((x) => !p.choices.some((c) => c.id === x));
    return (
      <div role="group" aria-label={p.label}>
        {label}
        <div className="flex flex-wrap gap-2">
          {p.choices.map((c) => {
            const i = cur.indexOf(c.id);
            return (
              <button key={c.id} type="button" aria-pressed={i >= 0} onClick={() => toggle(c.id)}
                onMouseEnter={() => c.preview && onHover(c.preview)} onMouseLeave={() => onHover(null)}
                onFocus={() => c.preview && onHover(c.preview)} onBlur={() => onHover(null)}
                className={chip(i >= 0)}>
                {c.preview && <img src={`/previews/${c.preview}.jpg`} alt="" className="h-8 w-[18px] rounded-[4px] object-cover" loading="lazy" onError={(e) => { e.currentTarget.style.display = "none"; }} />}
                {c.label}
                {i >= 0 && p.max > 1 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-ink px-1 text-[11px] text-white">{faNum(i + 1)}</span>}
              </button>
            );
          })}
          {customs.map((x) => (
            <span key={x} className={chip(true)}>
              {x}
              <span className="grid h-5 min-w-5 place-items-center rounded-full bg-ink px-1 text-[11px] text-white">{faNum(cur.indexOf(x) + 1)}</span>
              <button type="button" onClick={() => toggle(x)} aria-label={`حذف ${x}`} className="text-ink-soft hover:text-danger">×</button>
            </span>
          ))}
        </div>
        {p.custom && <CustomAdd placeholder={p.custom.placeholder} maxLength={p.custom.maxLength} disabled={cur.length >= p.max}
          onAdd={(t) => !cur.includes(t) && onChange([...cur, t])} />}
        {p.id === "prompts" && gen?.available && cur.length > 0 && (
          <GeneratePreviews texts={cur} style={String(values.gen_style ?? "auto")} theme={theme} onShow={onGenerated} />
        )}
        <p className="mt-1.5 text-[12px] text-ink-faint">حداکثر {faNum(p.max)} مورد{p.max > 1 ? "؛ به همین ترتیب نمایش داده می‌شن" : ""}.</p>
      </div>
    );
  }
  if (p.kind === "files") {
    return <FilesParam p={p} value={Array.isArray(value) ? value : []} videoId={videoId} onChange={onChange} label={label} />;
  }
  const v = typeof value === "string" ? value : "";
  const cls = "w-full rounded-[10px] border border-line bg-white px-3 py-2 text-[15px] leading-7 outline-none focus:border-violet";
  return (
    <label className="block">
      {label}
      {p.lines ? (
        <textarea value={v} rows={p.lines} maxLength={p.maxLength} placeholder={p.placeholder} onChange={(e) => onChange(e.target.value)} className={cls} />
      ) : (
        <input value={v} maxLength={p.maxLength} placeholder={p.placeholder} onChange={(e) => onChange(e.target.value)} className={cls} />
      )}
    </label>
  );
}

function imagegenReason(g: Capabilities["imagegen"] | undefined): string {
  if (!g) return "وضعیت مدل تصویرساز معلوم نیست.";
  if (g.reason === "off") return "مدل تصویرساز در تنظیمات خاموشه (IMAGEGEN=off).";
  if (g.reason === "no-binary") return "برنامه‌ی تصویرساز در ورکر نصب نیست. ورکر رو دوباره بساز: docker compose up -d --build worker";
  if (g.downloading) return `مدل تصویرساز در حال دانلوده${g.progress ? ` (${faNum(g.progress)}٪)` : ""}. بعد از دانلود این گزینه باز می‌شه.`;
  if (g.reason === "download-failed") return "دانلود مدل تصویرساز انجام نشد. راهنمای README رو ببین؛ می‌شه فایل مدل رو دستی هم گذاشت.";
  return "مدل تصویرساز هنوز آماده نیست.";
}

function CustomAdd({ placeholder, maxLength, disabled, onAdd }: { placeholder: string; maxLength: number; disabled: boolean; onAdd: (t: string) => void }) {
  const [t, setT] = useState("");
  const add = () => { const x = t.trim(); if (x) { onAdd(x); setT(""); } };
  return (
    <div className="mt-2 flex max-w-[480px] gap-2">
      <input value={t} maxLength={maxLength} placeholder={placeholder} disabled={disabled} onChange={(e) => setT(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
        className="min-w-0 flex-1 rounded-[10px] border border-line bg-white px-3 py-2 text-[15px] outline-none focus:border-violet disabled:opacity-50" />
      <button type="button" onClick={add} disabled={disabled || !t.trim()} className="rounded-[10px] bg-ink px-4 font-bold text-white disabled:opacity-40">افزودن</button>
    </div>
  );
}

/** Asks the worker to paint each written place once, so the creator sees it before the render. */
function GeneratePreviews({ texts, style, theme, onShow }: { texts: string[]; style: string; theme: Theme; onShow: (p: string | null) => void }) {
  const st = style !== "auto" ? style : ({ cartoon: "cartoon", anime: "anime", watercolor: "watercolor", oil: "oil", sketch: "sketch", pixel: "pixel", neon: "neon" } as Record<string, string>)[theme.look] ?? "photo";
  const [items, setItems] = useState<Record<string, { status: string; path?: string; key?: string; error?: string }>>({});
  const start = async (text: string) => {
    setItems((s) => ({ ...s, [text]: { status: "queued" } }));
    try {
      const r = await api<{ key: string; status: string; path?: string }>("/api/imagegen/preview", { method: "POST", json: { text, style: st } });
      setItems((s) => ({ ...s, [text]: r }));
      if (r.path) onShow(r.path);
    } catch (e) { setItems((s) => ({ ...s, [text]: { status: "failed", error: (e as Error).message } })); }
  };
  useEffect(() => {
    const pending = Object.entries(items).filter(([, v]) => v.key && (v.status === "queued" || v.status === "working"));
    if (!pending.length) return;
    const t = setTimeout(async () => {
      for (const [text, v] of pending) {
        try {
          const r = await api<{ status: string; path?: string; error?: string }>(`/api/imagegen/${v.key}`);
          setItems((s) => ({ ...s, [text]: { ...v, ...r } }));
          if (r.path) onShow(r.path);
        } catch { /* keep polling */ }
      }
    }, 2500);
    return () => clearTimeout(t);
  }, [items, onShow]);
  return (
    <div className="mt-3 rounded-[12px] bg-paper p-3">
      <p className="text-sm font-bold">قبل از رندر ببین هر محیط چه شکلی ساخته می‌شه <span className="font-normal text-ink-faint">(هر کدوم حدود یک دقیقه)</span></p>
      <ul className="mt-2 flex flex-col gap-1.5">
        {texts.map((t) => {
          const it = items[t];
          return (
            <li key={t} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-bold">{t}</span>
              {!it && <button type="button" onClick={() => start(t)} className="rounded-[8px] border border-line bg-white px-2.5 py-1 font-bold hover:border-ink">بساز و نشون بده</button>}
              {it && (it.status === "queued" || it.status === "working") && <span className="working rounded-[8px] bg-violet-wash px-2.5 py-1 font-bold text-violet-deep">در حال ساختن…</span>}
              {it?.status === "done" && it.path && <button type="button" onClick={() => onShow(it.path!)} className="font-bold text-violet-deep underline-offset-4 hover:underline">نمایش</button>}
              {it?.status === "failed" && <span className="font-bold text-danger">{it.error ?? "ساخته نشد"}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function FilesParam({ p, value, videoId, onChange, label }: {
  p: Extract<Param, { kind: "files" }>; value: string[]; videoId: string; onChange: (v: string[]) => void; label: React.ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true); setError(null);
    const added: string[] = [];
    try {
      for (const f of [...files].slice(0, p.max - value.length)) {
        const fd = new FormData(); fd.append("file", f);
        const res = await fetch(`${DIRECT_API}/api/videos/${videoId}/assets`, { method: "POST", body: fd, credentials: "include" });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? `آپلود انجام نشد (خطای ${res.status})`);
        added.push(body.path);
      }
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); if (added.length) onChange([...value, ...added]); if (input.current) input.current.value = ""; }
  };
  return (
    <div>
      {label}
      <div className="flex flex-wrap items-center gap-2">
        {value.map((f, i) => (
          <span key={f} className={chip(true)}>
            {/\.(mp4|mov|webm|m4v)$/i.test(f) ? "ویدیو" : "عکس"} {faNum(i + 1)}
            <button type="button" onClick={() => onChange(value.filter((x) => x !== f))} aria-label="حذف" className="text-ink-soft hover:text-danger">×</button>
          </span>
        ))}
        {value.length < p.max && (
          <button type="button" onClick={() => input.current?.click()} disabled={busy} className="rounded-[10px] border border-dashed border-ink px-3 py-2 text-sm font-bold disabled:opacity-50">
            {busy ? "در حال آپلود…" : "افزودن عکس یا ویدیو"}
          </button>
        )}
        <input ref={input} type="file" accept={p.accept} multiple hidden onChange={(e) => upload(e.target.files)} />
      </div>
      {error && <p className="mt-2 text-sm font-bold text-danger" role="alert">{error}</p>}
      <p className="mt-1.5 text-[12px] text-ink-faint">عکس یا ویدیوی عمودی بهتر جا می‌افته. به همین ترتیب پشت سرت نمایش داده می‌شن.</p>
    </div>
  );
}
