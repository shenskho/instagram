"use client";
import { useRef } from "react";
import { EDIT_OPTIONS, OPTION_GROUPS, type EditOption } from "@autoreel/shared";
import { faNum } from "@/lib/format";

/**
 * Edit options as small reel frames. Pointing at one (hover, keyboard focus or touch) plays a short loop of
 * what it does, rendered by the engine itself; clicking it adds it to the reel.
 */
export function OptionPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const sel = new Set(value);
  const toggle = (id: string) => onChange(sel.has(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="text-sm text-ink-soft">
          نشانگر رو روی هر گزینه نگه دار تا ببینی چی کار می‌کنه. هر چندتا که بخوای انتخاب کن؛ همه‌شون در ریلز میان و کارگردان هر جا لازم بدونه چیزهای دیگه هم اضافه می‌کنه.
        </p>
        {value.length > 0 && (
          <span className="text-sm font-bold">
            {faNum(value.length)} گزینه انتخاب شد
            <button type="button" onClick={() => onChange([])} className="ms-3 font-bold text-ink-faint underline-offset-4 hover:text-danger hover:underline">پاک کردن</button>
          </span>
        )}
      </div>
      {OPTION_GROUPS.map((g) => (
        <fieldset key={g.id}>
          <legend className="font-black">{g.label} <span className="text-sm font-normal text-ink-faint">{g.hint}</span></legend>
          <div className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {EDIT_OPTIONS.filter((o) => o.group === g.id).map((o) => <OptionCard key={o.id} o={o} on={sel.has(o.id)} onToggle={() => toggle(o.id)} />)}
          </div>
        </fieldset>
      ))}
    </div>
  );
}

function OptionCard({ o, on, onToggle }: { o: EditOption; on: boolean; onToggle: () => void }) {
  const vid = useRef<HTMLVideoElement>(null);
  const play = () => { const v = vid.current; if (v) { v.currentTime = 0; v.play().catch(() => undefined); } };
  const stop = () => { const v = vid.current; if (v) { v.pause(); v.currentTime = 0; } };
  return (
    <button
      type="button"
      aria-pressed={on}
      title={o.hint}
      onClick={onToggle}
      onMouseEnter={play} onMouseLeave={stop} onFocus={play} onBlur={stop} onTouchStart={play}
      className="group flex flex-col gap-2 text-start"
    >
      <span className={`relative block aspect-[9/16] w-full overflow-hidden rounded-[14px] bg-ink transition-shadow ${on ? "shadow-[0_0_0_3px_var(--color-ink)]" : "shadow-[0_0_0_1px_var(--color-line)] group-hover:shadow-[0_0_0_2px_var(--color-violet)]"}`}>
        <video ref={vid} src={`/previews/${o.id}.mp4`} poster={`/previews/${o.id}.jpg`} muted loop playsInline preload="none"
          className="h-full w-full object-cover" aria-hidden />
        <span className={`absolute end-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full border-2 transition-colors ${on ? "border-ink bg-cap text-ink" : "border-white/80 bg-black/25 text-transparent"}`} aria-hidden>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
        </span>
      </span>
      <span className="block leading-5">
        <span className={`block text-[14px] ${on ? "font-black" : "font-bold"}`}>{o.label}</span>
        <span className="mt-0.5 block text-[12px] leading-[18px] text-ink-faint">{o.hint}</span>
      </span>
    </button>
  );
}
