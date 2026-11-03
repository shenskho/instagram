"use client";

const field = "mt-2 w-full resize-y rounded-[10px] border bg-white px-3 py-2.5 text-[16px] leading-7 outline-none focus:border-violet";

/** Point of view (always optional) and description (required when nobody speaks). */
export function BriefFields({ pov, description, spoken, onPov, onDescription, compact }: {
  pov: string; description: string; spoken: boolean; onPov: (v: string) => void; onDescription: (v: string) => void; compact?: boolean;
}) {
  const required = !spoken;
  return (
    <section className={`grid gap-6 ${compact ? "" : "lg:grid-cols-2"}`} aria-label="توضیح ویدیو برای کارگردان">
      <label className="block">
        <span className="font-black">زاویه‌ی دید ویدیو</span> <span className="text-sm text-ink-faint">اختیاری</span>
        <span className="mt-1 block text-sm text-ink-soft">این ویدیو قراره بیننده رو به چی برسونه؟ کلمه‌هایی از این متن که توی حرف‌هات هم هست، در زیرنویس برجسته می‌شن و گرافیک‌ها روشون می‌شینن.</span>
        <textarea value={pov} onChange={(e) => onPov(e.target.value)} rows={3} maxLength={2000}
          placeholder="مثلاً: می‌خوام نشون بدم ادیت با هوش مصنوعی چقدر سریع و ساده‌ست"
          className={`${field} border-line`} />
      </label>
      <label className="block">
        <span className="font-black">{required ? "توضیح کوتاه ویدیو" : "توضیح تصویر"}</span>{" "}
        <span className={`text-sm ${required ? "font-bold text-danger" : "text-ink-faint"}`}>{required ? "لازمه" : "اختیاری"}</span>
        <span className="mt-1 block text-sm text-ink-soft">
          {required
            ? "توی ویدیو چه اتفاقی می‌افته؟ چند جمله‌ی کوتاه بنویس؛ هر جمله به‌ترتیب روی تصویر نمایش داده می‌شه."
            : "برای بخش‌هایی که کسی حرف نمی‌زنه (مثلاً ویدیوهای بدون صدا بین بقیه). هر جمله به‌ترتیب روی همون بخش‌ها نمایش داده می‌شه."}
        </span>
        <textarea value={description} onChange={(e) => onDescription(e.target.value)} rows={3} maxLength={2000} required={required}
          placeholder="مثلاً: صبح زود رسیدیم کارگاه. اینجا قطعه‌ها رو برش می‌زنیم. نتیجه‌ی نهایی رو ببین."
          className={`${field} ${required && !description.trim() ? "border-cap" : "border-line"}`} />
      </label>
    </section>
  );
}
