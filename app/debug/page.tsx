"use client";
import { useEffect, useState } from "react";

type Dbg = {
  tokenSet: boolean; store: string;
  hydration: { step: number; total: number; done: boolean; next: string | null };
  meta: { lastError: string | null; callCount: number; lastCallTool: string | null };
  analysis: { schema: Record<string, string[]>; counts: Record<string, number>; warnings: string[] };
  cached: { tool: string; args: Record<string, unknown>; fetchedAt: number }[];
  raw: Record<string, unknown>;
};

function report(d: Dbg) {
  const parts = [
    "ACCOUNT QUEST DEBUG REPORT",
    `tokenSet=${d.tokenSet} store=${d.store} hydration=${d.hydration.step}/${d.hydration.total} calls=${d.meta.callCount} lastError=${d.meta.lastError ?? "none"}`,
    `warnings: ${d.analysis.warnings.join(" | ") || "none"}`,
    `records found by analyzer: ${JSON.stringify(d.analysis.counts)}`,
    `field names seen: ${JSON.stringify(d.analysis.schema)}`,
    "--- RAW SAMPLES (trimmed) ---",
    ...Object.entries(d.raw).map(([k, v]) => `## ${k}\n${JSON.stringify(v, null, 1).slice(0, 2500)}`),
  ];
  return parts.join("\n\n").slice(0, 24000);
}

export default function DebugPage() {
  const [d, setD] = useState<Dbg | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const load = () => fetch("/api/state?debug=1", { cache: "no-store" }).then((r) => r.json()).then(setD).catch(() => {});
    load(); const t = setInterval(load, 5000); return () => clearInterval(t);
  }, []);
  if (!d) return <main className="p-6 text-slate-400">Loading…</main>;
  const copy = async () => { await navigator.clipboard.writeText(report(d)); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  return (
    <main className="mx-auto max-w-4xl p-4">
      <div className="mb-3 flex items-center gap-3">
        <a href="/" className="text-sky-300 underline">← Dashboard</a>
        <h1 className="text-lg font-semibold">Debug</h1>
        <button onClick={copy} className="ml-auto rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium hover:bg-emerald-500">{copied ? "Copied!" : "Copy report for Claude"}</button>
      </div>
      <div className="mb-3 rounded border border-slate-800 bg-slate-900 p-3 text-sm">
        <p>Token set: <b className={d.tokenSet ? "text-emerald-300" : "text-red-300"}>{String(d.tokenSet)}</b> · Store: <b>{d.store}</b> · Hydration: <b>{d.hydration.step}/{d.hydration.total}</b> {d.hydration.next && `(next: ${d.hydration.next})`}</p>
        {d.meta.lastError && <p className="mt-1 text-red-300">Last error: {d.meta.lastError}</p>}
        {d.analysis.warnings.map((w) => <p key={w} className="mt-1 text-amber-300">⚠ {w}</p>)}
        <p className="mt-2 text-slate-400">Analyzer found: {Object.entries(d.analysis.counts).map(([k, v]) => `${k} ${v}`).join(" · ")}</p>
        <p className="text-xs text-slate-500">If deals / facts / people show 0 after hydration finishes, press the green button and paste the report to Claude.</p>
      </div>
      {Object.entries(d.raw).map(([k, v]) => (
        <details key={k} className="mb-2 rounded border border-slate-800 bg-slate-900/60 p-2">
          <summary className="cursor-pointer font-mono text-sm">{k.slice(0, 90)}</summary>
          <pre className="mt-2 max-h-80 overflow-auto rounded bg-slate-950 p-2 text-[11px] text-slate-300">{JSON.stringify(v, null, 2).slice(0, 6000)}</pre>
        </details>
      ))}
      {!Object.keys(d.raw).length && <p className="text-slate-500">Nothing cached yet. Keep the dashboard tab open while hydration runs.</p>}
    </main>
  );
}
