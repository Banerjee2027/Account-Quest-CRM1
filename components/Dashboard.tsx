"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Receipt } from "@/lib/analyzer";
import type { Draft, Move, StateResp } from "./types";
import { Q1, Q2, Q3, Q4, Q5 } from "./Cards";
import { NoteDrawer, ReceiptDrawer } from "./Drawers";
import { Badge, Level, usd } from "./ui";

type Tab = "overview" | "A" | "B";
const ago = (t: number | null, now: number) => (t ? `${Math.max(0, Math.round((now - t) / 1000))}s ago` : "never");

export default function Dashboard() {
  const [st, setSt] = useState<StateResp | null>(null);
  const [now, setNow] = useState(Date.now());
  const [tab, setTab] = useState<Tab>("overview");
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [offline, setOffline] = useState(false);
  const waitUntil = useRef(0); const busy = useRef(false); const lastPoll = useRef(0);

  const load = useCallback(async () => {
    try {
      const s: StateResp = await (await fetch("/api/state", { cache: "no-store" })).json();
      setSt(s); setOffline(false); waitUntil.current = Date.now() + s.waitMs;
    } catch { setOffline(true); }
  }, []);
  const poll = useCallback(async () => {
    if (busy.current) return; busy.current = true; lastPoll.current = Date.now();
    try { await fetch("/api/live-poll", { cache: "no-store" }); } catch { /* ignore */ }
    busy.current = false; load();
  }, [load]);

  useEffect(() => {
    load(); poll();
    const a = setInterval(() => document.visibilityState === "visible" && load(), 5000);
    const b = setInterval(() => {
      setNow(Date.now());
      if (document.visibilityState === "visible" && Date.now() >= waitUntil.current + 500 && Date.now() - lastPoll.current > 4000) poll();
    }, 1000);
    return () => { clearInterval(a); clearInterval(b); };
  }, [load, poll]);

  const openDraft = (acct: "A" | "B", m: Move) => setDraft({ account: acct, kind: "next_step", title: m.draft.title, text: m.draft.text, refs: m.draft.refs });
  const submit = async (d: Draft) => {
    const r = await fetch("/api/notes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(d) });
    if (!r.ok) return ((await r.json().catch(() => ({}))).error as string) ?? "Failed";
    setDraft(null); load(); return null;
  };
  const retry = async (id: string) => { await fetch("/api/notes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ retry: id }) }); load(); };

  if (!st) return <main className="p-10 text-slate-400">{offline ? "Cannot reach /api/state" : "Loading…"}</main>;
  const an = st.analysis; const remain = Math.max(0, Math.ceil((waitUntil.current - now) / 1000));
  const pct = Math.round((st.hydration.step / st.hydration.total) * 100);
  const a = tab === "overview" ? null : an.accounts[tab];

  return (
    <main className="mx-auto max-w-7xl p-4">
      <header className="mb-3 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Account Quest CRM</h1>
        <nav className="ml-auto flex gap-1">
          {(["overview", "A", "B"] as Tab[]).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`rounded px-3 py-1.5 text-sm ${tab === t ? "bg-sky-500 font-semibold text-slate-950" : "bg-slate-800 hover:bg-slate-700"}`}>
              {t === "overview" ? "Executive Overview" : t === "A" ? "A · Eastern Counties" : "B · Aldermoor"}</button>))}
        </nav>
        <a href="/debug" className="rounded bg-slate-800 px-3 py-1.5 text-sm hover:bg-slate-700">Debug</a>
        <button onClick={() => setDraft({ account: tab === "B" ? "B" : "A", kind: "note", title: "", text: "", refs: [] })} className="rounded bg-emerald-600 px-3 py-1.5 text-sm hover:bg-emerald-500">+ Note</button>
      </header>

      {/* Status bar */}
      <div className="mb-4 rounded-lg border border-slate-800 bg-slate-900 p-3 text-xs">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span>MCP slot: <b className={remain ? "text-amber-300" : "text-emerald-300"}>{remain ? `next call in ${remain}s` : "ready"}</b></span>
          <span>Last call: <b>{st.meta.lastCallTool ?? "none"}</b> ({ago(st.meta.lastCallAt, now)}) · calls: {st.meta.callCount}</span>
          <span>Signals polled: {ago(st.meta.lastSignalsAt, now)}</span>
          <span>Store: <Badge tone={st.store === "upstash" ? "green" : "amber"}>{st.store}</Badge></span>
          {offline && <Badge tone="red">offline, retrying</Badge>}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <div className="h-1.5 flex-1 rounded bg-slate-800"><div className="h-1.5 rounded bg-sky-500 transition-all" style={{ width: `${pct}%` }} /></div>
          <span>{st.hydration.done ? "Hydrated · live polling" : `Hydrating ${st.hydration.step}/${st.hydration.total} · next: ${st.hydration.next}`}</span>
        </div>
        {!st.tokenSet && <p className="mt-1 font-semibold text-red-300">AQ_TOKEN is not set on the server. Add it in .env.local (local) or Vercel Environment Variables, then redeploy.</p>}
        {st.store !== "upstash" && <p className="mt-1 text-amber-300">Store is not persistent across serverless instances. Add Upstash/Vercel KV env vars for reliable caching.</p>}
        {st.meta.lastError && <p className="mt-1 text-red-300">Last error: {st.meta.lastError}</p>}
        {an.warnings.map((w) => <p key={w} className="mt-1 text-amber-300">⚠ {w}</p>)}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          {!a ? (
            <>
              <div className="grid gap-3 md:grid-cols-2">
                {an.overview.map((o) => (
                  <button key={o.key} onClick={() => setTab(o.key)} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-left hover:border-sky-500">
                    <h2 className="font-semibold">{o.key} · {o.name}</h2>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                      <div><div className="text-xs text-emerald-300">Backed</div>{usd(o.backed)}</div>
                      <div><div className="text-xs text-amber-300">Unbacked</div>{usd(o.unbacked)}</div>
                      <div><Level l="red" /> {o.reds} &nbsp; <Level l="amber" /> {o.ambers}</div>
                      <div className="text-slate-300">{o.gaps} blind spots</div>
                    </div>
                    <p className="mt-2 text-xs text-slate-400">First move: {o.topMove ?? "none yet"}</p>
                  </button>))}
              </div>
              <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                <h2 className="mb-2 font-semibold">Most urgent risks across both accounts</h2>
                {(["A", "B"] as const).flatMap((k) => an.accounts[k].q4.filter((r) => r.level !== "green").slice(0, 3).map((r) => ({ k, r }))).map(({ k, r }) => (
                  <div key={k + r.id} className="mb-1 flex items-center gap-2 text-sm"><Level l={r.level} /><Badge>{k}</Badge><span className="truncate">{r.title}</span><span className="ml-auto text-xs text-slate-500">{r.trigger ?? ""}</span></div>))}
              </section>
            </>
          ) : (
            <>
              <h2 className="text-lg font-semibold">{a.name}</h2>
              <Q1 a={a} open={setReceipt} /><Q2 a={a} open={setReceipt} />
              <Q3 a={a} open={setReceipt} onDraft={(m) => openDraft(a.key, m)} />
              <Q4 a={a} open={setReceipt} /><Q5 a={a} open={setReceipt} />
            </>
          )}
        </div>

        <aside className="space-y-4">
          <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
            <h3 className="mb-2 text-sm font-semibold">Live signals <span className="font-normal text-slate-500">({st.signals.length})</span></h3>
            <div className="max-h-80 space-y-2 overflow-y-auto">
              {!st.signals.length && <p className="text-xs text-slate-500">Waiting for first get_signals poll after hydration.</p>}
              {st.signals.map((s) => (
                <div key={s.key} className="rounded bg-slate-950 p-2 text-xs"><div className="text-slate-500">{ago(s.seenAt, now)}</div>
                  <div className="break-words text-slate-300">{(typeof s.signal === "string" ? s.signal : JSON.stringify(s.signal)).slice(0, 220)}</div></div>))}
            </div>
          </section>
          <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
            <h3 className="mb-2 text-sm font-semibold">Write-back queue</h3>
            {!st.notes.length && <p className="text-xs text-slate-500">No notes yet.</p>}
            {[...st.notes].reverse().slice(0, 10).map((n) => (
              <div key={n.id} className="mb-2 rounded bg-slate-950 p-2 text-xs">
                <div className="flex items-center gap-1"><Badge tone={n.status === "synced" ? "green" : n.status === "failed" ? "red" : "amber"}>{n.status}</Badge><Badge>{n.kind}</Badge><span className="truncate">{n.title}</span></div>
                {n.error && <p className="mt-1 text-red-300">{n.error}</p>}
                {n.status === "failed" && <button onClick={() => retry(n.id)} className="mt-1 text-sky-300 underline">retry</button>}
              </div>))}
          </section>
        </aside>
      </div>

      {receipt && <ReceiptDrawer r={receipt} onClose={() => setReceipt(null)} />}
      {draft && <NoteDrawer key={draft.title + draft.account} init={draft} onClose={() => setDraft(null)} onSubmit={submit} />}
    </main>
  );
}
