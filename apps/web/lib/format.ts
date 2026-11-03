const fa = new Intl.NumberFormat("fa-IR");
export const faNum = (n: number | string) => (typeof n === "number" ? fa.format(n) : n.replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[+d]));
export function clock(sec: number) {
  const s = Math.max(0, Math.round(sec));
  return faNum(`${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`);
}
export function when(iso: string) {
  return new Intl.DateTimeFormat("fa-IR", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}
