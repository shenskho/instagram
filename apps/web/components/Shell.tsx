"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

const NAV = [
  { href: "/", label: "ویدیوها" },
  { href: "/settings", label: "سبک پیج" },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [email, setEmail] = useState<string | null>(null);
  useEffect(() => { api<{ email: string }>("/api/auth/me").then((u) => setEmail(u.email)).catch(() => undefined); }, []);
  const logout = async () => { await api("/api/auth/logout", { method: "POST" }); window.location.href = "/login"; };
  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-white/70 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-8 px-5 py-4">
          <Link href="/" className="flex items-center gap-2" aria-label="AutoReel">
            <span className="grid h-8 w-[18px] place-items-center rounded-[5px] bg-ink"><span className="h-3 w-[7px] rounded-[2px] bg-cap" /></span>
            <span className="text-lg font-black tracking-tight" dir="ltr">AutoReel</span>
          </Link>
          <nav className="flex gap-1">
            {NAV.map((n) => {
              const active = n.href === "/" ? path === "/" || path.startsWith("/videos") : path.startsWith(n.href);
              return (
                <Link key={n.href} href={n.href} className={`rounded-lg px-3 py-1.5 text-[15px] font-bold transition-colors ${active ? "bg-violet-wash text-violet-deep" : "text-ink-soft hover:text-ink"}`}>
                  {n.label}
                </Link>
              );
            })}
          </nav>
          <div className="ms-auto flex items-center gap-4 text-sm text-ink-soft">
            {email && <span dir="ltr" className="hidden sm:inline">{email}</span>}
            <button onClick={logout} className="font-bold text-ink-soft hover:text-danger">خروج</button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-5 py-8">{children}</main>
    </div>
  );
}
