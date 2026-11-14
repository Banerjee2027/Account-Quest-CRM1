"use client";
import { useEffect, useState } from "react";
import type { Receipt } from "@/lib/analyzer";
import type { Draft } from "./types";
import { Badge, Chips } from "./ui";

function find(n: unknown, id: string, out: unknown[], d = 0) {
  if (d > 12 || out.length >= 3 || n == null) return;
  if (Array.isArray(n)) { n.forEach((x) => find(x, id, out, d + 1)); return; }
  if (typeof n === "object") {
    const o = n as Record<string, unknown>;
    if (Object.entries(o).some(([k, v]) => v === id && /(_id$|^id$|^path$)/.test(k))) { out.push(o); return; }
    Object.values(o).forEach((v) => find(v, id, out, d + 1));
  }
}

export function ReceiptDrawer({ r, onClose }: { r: Receipt; onClose: () => void }) {
  const [rec, setRec] = useState<unknown[] | null>(null);
  useEffect(() => {
    let live = true;
    fetch("/api/state?debug=1").then((x) => x.json()).then((s) => { const out: unknown[] = []; find(s.raw, r.id, out); if (live) setRec(out); }).catch(() => live && setRec([]));
    return () => { live = false; };
  }, [r.id]);
  return (
    <aside className="fixed inset-y-0 right-0 z-30 w-full max-w-md overflow-y-auto border-l border-slate-700 bg-slate-900 p-4 shadow-2xl">
      <div className="flex items-center justify-between"><h3 className="font-semibold">Source receipt</h3><button onClick={onClose} className="text-slate-400 hover:text-white">✕</button></div>
      <p className="mt-3 font-mono text-sm text-sky-300">{r.kind}: {r.id}</p>
      {r.prov && <div className="mt-1"><Badge tone={r.prov === "verified" ? "green" : "amber"}>{r.prov}</Badge></div>}
      {r.excerpt && <blockquote className="mt-3 border-l-2 border-slate-600 pl-3 text-sm text-slate-300">{r.excerpt}</blockquote>}
      <h4 className="mt-4 text-xs font-semibold uppercase text-slate-500">Raw record in MCP cache</h4>
      {rec == null ? <p className="text-xs text-slate-500">Loading…</p> : !rec.length ? <p className="text-xs text-slate-500">No raw record with this exact ID found (may live inside a text body).</p>
        : rec.map((x, i) => <pre key={i} className="mt-2 max-h-72 overflow-auto rounded bg-slate-950 p-2 text-[11px] text-slate-300">{JSON.stringify(x, null, 2).slice(0, 3000)}</pre>)}
    </aside>
  );
}

export function NoteDrawer({ init, onClose, onSubmit }: { init: Draft; onClose: () => void; onSubmit: (d: Draft) => Promise<string | null> }) {
  const [d, setD] = useState(init); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const inp = "w-full rounded border border-slate-700 bg-slate-950 p-2 text-sm";
  return (
    <aside className="fixed inset-y-0 right-0 z-30 w-full max-w-md overflow-y-auto border-l border-slate-700 bg-slate-900 p-4 shadow-2xl">
      <div className="flex items-center justify-between"><h3 className="font-semibold">Write note to MCP</h3><button onClick={onClose} className="text-slate-400 hover:text-white">✕</button></div>
      <p className="mt-1 text-xs text-slate-400">Saved instantly as <b>queued</b>, sent in the next free 1-minute slot.</p>
      <label className="mt-3 block text-xs text-slate-400">Account
        <select className={inp} value={d.account} onChange={(e) => setD({ ...d, account: e.target.value as "A" | "B" })}><option value="A">A · Eastern Counties Police Alliance</option><option value="B">B · Aldermoor Industrial Group</option></select></label>
      <label className="mt-2 block text-xs text-slate-400">Kind
        <select className={inp} value={d.kind} onChange={(e) => setD({ ...d, kind: e.target.value })}>{["note", "task", "risk", "next_step"].map((k) => <option key={k}>{k}</option>)}</select></label>
      <label className="mt-2 block text-xs text-slate-400">Title<input className={inp} value={d.title} maxLength={200} onChange={(e) => setD({ ...d, title: e.target.value })} /></label>
      <label className="mt-2 block text-xs text-slate-400">Text<textarea className={inp} rows={8} value={d.text} maxLength={4000} onChange={(e) => setD({ ...d, text: e.target.value })} /></label>
      {!!d.refs.length && <div className="mt-2"><div className="text-xs text-slate-500">Evidence IDs in note</div><Chips rs={d.refs.map((id) => ({ id, kind: "ref" }))} open={() => {}} /></div>}
      {err && <p className="mt-2 text-xs text-red-300">{err}</p>}
      <button disabled={busy || !d.title.trim() || !d.text.trim()} onClick={async () => { setBusy(true); setErr(await onSubmit(d)); setBusy(false); }}
        className="mt-3 w-full rounded bg-emerald-600 py-2 text-sm font-medium hover:bg-emerald-500 disabled:opacity-40">Queue note</button>
    </aside>
  );
}
