import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "AutoReel — ادیت خودکار ریلز", description: "ویدیوی خام رو آپلود کن، متن رو تأیید کن، ریلز ادیت‌شده تحویل بگیر." };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fa" dir="rtl">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
