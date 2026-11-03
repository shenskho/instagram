"use client";
import { useCallback, useEffect, useState } from "react";
import { Shell } from "@/components/Shell";
import { UploadFrame } from "@/components/UploadFrame";
import { VideoList } from "@/components/VideoList";
import { api } from "@/lib/api";
import { BUSY, type VideoRow } from "@/lib/types";

export default function Home() {
  const [items, setItems] = useState<VideoRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => api<VideoRow[]>("/api/videos").then(setItems).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!items?.some((v) => BUSY.includes(v.status))) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [items, load]);
  return (
    <Shell>
      <div className="grid gap-10 md:grid-cols-[260px_1fr]">
        <aside><UploadFrame onUploaded={load} /></aside>
        <section>
          <h1 className="mb-1 text-2xl font-black">ویدیوها</h1>
          <p className="mb-5 text-ink-soft">بعد از آپلود، ویدیو تحلیل می‌شه و متنش برای تأیید نمایش داده می‌شه. بعد از تأیید، ادیت و رندر خودکار انجام می‌شه.</p>
          {error && <p className="mb-4 font-bold text-danger" role="alert">{error}</p>}
          {items ? <VideoList items={items} /> : <div className="h-40 animate-pulse rounded-2xl bg-line/60" />}
        </section>
      </div>
    </Shell>
  );
}
