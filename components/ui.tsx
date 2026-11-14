"use client";
import type { Receipt } from "@/lib/analyzer";

export const usd = (n: number | null) =>
  n == null ? "n/a" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

const LV = {
  red: "bg-red-500/20 text-red-300 ring-red-500/40",
  amber: "bg-amber-500/20 text-amber-300 ring-amber-500/40",
  green: "bg-emerald-500/20 text-emerald-300 ring-emerald-500/40",
} as const;
export function Level({ l }: { l: keyof typeof LV }) {
  return <span className={`rounded px-2 py-0.5 text-xs font-semibold uppercase ring-1 ${LV[l]}`}>{l}</span>;
}
const TONES = {
  slate: "bg-slate-700 text-slate-200", green: "bg-emerald-500/20 text-emerald-300",
  amber: "bg-amber-500/20 text-amber-300", red: "bg-red-500/20 text-red-300", blue: "bg-sky-500/20 text-sky-300",
};
export function Badge({ children, tone = "slate" }: { children: React.ReactNode; tone?: keyof typeof TONES }) {
  return <span className={`rounded px-1.5 py-0.5 text-xs ${TONES[tone]}`}>{children}</span>;
}
export function Chips({ rs, open }: { rs: Receipt[]; open: (r: Receipt) => void }) {
  if (!rs.length) return <span className="text-xs text-slate-500">no receipt (structural gap)</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {rs.map((r, i) => (
        <button key={r.kind + r.id + i} onClick={() => open(r)} title={r.excerpt}
          className="rounded border border-slate-600 bg-slate-800 px-1.5 py-0.5 font-mono text-[11px] text-sky-300 hover:bg-slate-700">
          {r.kind.replace("_id", "")}:{r.id.length > 28 ? r.id.slice(0, 26) + "…" : r.id}
        </button>
      ))}
    </div>
  );
}
export function Card({ n, title, sub, children }: { n: number; title: string; sub: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <header className="mb-3">
        <h2 className="text-base font-semibold"><span className="mr-2 rounded bg-sky-500/20 px-1.5 text-sky-300">Q{n}</span>{title}</h2>
        <p className="text-xs text-slate-400">{sub}</p>
      </header>
      {children}
    </section>
  );
}
export const Empty = ({ t }: { t: string }) => <p className="rounded border border-dashed border-slate-700 p-3 text-sm text-slate-500">{t}</p>;
