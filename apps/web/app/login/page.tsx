"use client";
import { useState } from "react";
import { api } from "@/lib/api";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try { await api("/api/auth/login", { method: "POST", json: { email, password } }); window.location.href = "/"; }
    catch (err) { setError((err as Error).message); setBusy(false); }
  };
  return (
    <main className="grid min-h-screen place-items-center px-5">
      <div className="grid w-full max-w-3xl items-center gap-10 md:grid-cols-[1fr_220px]">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <h1 className="text-3xl font-black leading-[1.5]">ویدیوی خامت رو بده، ریلز ادیت‌شده تحویل بگیر</h1>
          <p className="text-ink-soft">ایمیل و رمزی رو بزن که در فایل تنظیمات (<bdi dir="ltr">.env</bdi>) نوشتی.</p>
          <label className="text-sm text-ink-soft">ایمیل
            <input dir="ltr" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username"
              className="mt-1 w-full rounded-[10px] border border-line bg-white px-3 py-2.5 text-[15px] text-ink outline-none focus:border-violet" />
          </label>
          <label className="text-sm text-ink-soft">رمز عبور
            <input dir="ltr" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password"
              className="mt-1 w-full rounded-[10px] border border-line bg-white px-3 py-2.5 text-[15px] text-ink outline-none focus:border-violet" />
          </label>
          {error && <p className="text-sm font-bold text-danger" role="alert">{error}</p>}
          <button disabled={busy} className="mt-2 rounded-[10px] bg-ink px-5 py-3 font-black text-white transition-colors hover:bg-violet-deep disabled:opacity-60">
            {busy ? "در حال ورود…" : "ورود"}
          </button>
        </form>
        <div className="reel-frame mx-auto hidden w-[220px] md:block" aria-hidden>
          <div className="flex h-full flex-col justify-end gap-2 p-5 pb-16">
            <span className="self-center text-center text-lg font-black leading-9 text-white [text-shadow:0_2px_0_#000]">این ویدیو رو <span className="cap">هیچ انسانی</span> ادیت نکرده</span>
          </div>
        </div>
      </div>
    </main>
  );
}
