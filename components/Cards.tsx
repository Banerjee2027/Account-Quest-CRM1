"use client";
import type { AccountAnalysis, Move, Receipt } from "@/lib/analyzer";
import { Badge, Card, Chips, Empty, Level, usd } from "./ui";

type P = { a: AccountAnalysis; open: (r: Receipt) => void };

export function Q1({ a, open }: P) {
  const { deals, backedTotal, unbackedTotal, unvaluedCount } = a.q1;
  return (
    <Card n={1} title="What is the book worth?" sub="Backed = verified by a file on record. Unbacked = told by a person or an unverified claim. Never summed together.">
      <div className="mb-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded bg-emerald-500/10 p-2"><div className="text-xs text-emerald-300">Backed value</div><div className="text-lg font-semibold">{usd(backedTotal)}</div></div>
        <div className="rounded bg-amber-500/10 p-2"><div className="text-xs text-amber-300">Unbacked / claimed</div><div className="text-lg font-semibold">{usd(unbackedTotal)}</div></div>
        <div className="rounded bg-slate-800 p-2"><div className="text-xs text-slate-400">Deals / no value</div><div className="text-lg font-semibold">{deals.length} / {unvaluedCount}</div></div>
      </div>
      {!deals.length ? <Empty t="No deals found in cached MCP data yet." /> : (
        <div className="space-y-2">
          {deals.map((d) => (
            <details key={d.deal_id} className="rounded border border-slate-800 bg-slate-950/50 p-2">
              <summary className="flex cursor-pointer flex-wrap items-center gap-2">
                <span className="font-medium">{d.name}</span>
                <span className="font-mono text-xs text-slate-500">{d.deal_id}</span>
                <Badge tone="blue">{d.stage}</Badge>
                <span className="ml-auto font-semibold">{usd(d.value)}</span>
                <Badge tone={d.backed ? "green" : "amber"}>{d.backed ? "BACKED" : `UNBACKED · ${d.prov}`}</Badge>
              </summary>
              <p className="mt-2 text-xs text-slate-400">{d.why}</p>
              <div className="mt-2"><div className="mb-1 text-xs text-slate-500">Source receipts</div><Chips rs={d.receipts} open={open} /></div>
            </details>
          ))}
        </div>
      )}
    </Card>
  );
}

const stanceTone = (s: string) => (s === "ally" || s === "warm" ? "green" : s === "guarded" ? "amber" : s === "unknown" ? "slate" : "blue") as "green" | "amber" | "slate" | "blue";
export function Q2({ a, open }: P) {
  return (
    <Card n={2} title="Who holds the power?" sub="Roles per deal with stance. Missing roles and single-threading are flagged.">
      {!a.q2.length ? <Empty t="No deals to map yet." /> : a.q2.map((p) => (
        <div key={p.deal_id} className="mb-3 rounded border border-slate-800 bg-slate-950/50 p-2">
          <div className="mb-2 flex items-center gap-2"><span className="font-medium">{p.deal}</span><span className="font-mono text-xs text-slate-500">{p.deal_id}</span></div>
          <div className="grid gap-2 sm:grid-cols-2">
            {Object.entries(p.roles).map(([role, ppl]) => (
              <div key={role} className="rounded bg-slate-900 p-2">
                <div className="mb-1 text-xs font-semibold text-slate-300">{role}</div>
                {!ppl.length ? <span className="text-xs text-red-300">{role === "Potential Blocker" ? "none identified" : "MISSING"}</span> : ppl.map((x) => (
                  <div key={x.person_id} className="mb-1">
                    <span className="text-sm">{x.name}</span> <Badge tone={stanceTone(x.stance)}>{x.stance}</Badge>
                    <Chips rs={x.receipts} open={open} />
                  </div>
                ))}
              </div>
            ))}
          </div>
          {p.flags.map((f) => <p key={f} className="mt-2 text-xs text-amber-300">⚠ {f}</p>)}
        </div>
      ))}
    </Card>
  );
}

export function Q3({ a, open, onDraft }: P & { onDraft: (m: Move) => void }) {
  return (
    <Card n={3} title="What do you do first?" sub="Top 3 moves ranked by deal value, urgency and deadline.">
      {!a.q3.length ? <Empty t="No moves derived yet." /> : a.q3.map((m) => (
        <div key={m.rank} className="mb-2 rounded border border-slate-800 bg-slate-950/50 p-3">
          <div className="flex items-start gap-3">
            <span className="rounded bg-sky-500 px-2 py-0.5 text-sm font-bold text-slate-950">#{m.rank}</span>
            <div className="flex-1">
              <p className="font-medium">{m.title}</p>
              <dl className="mt-1 grid gap-x-4 gap-y-0.5 text-xs text-slate-400 sm:grid-cols-3">
                <div><dt className="inline text-slate-500">Owner: </dt><dd className="inline text-slate-200">{m.owner}</dd></div>
                <div><dt className="inline text-slate-500">Deadline: </dt><dd className="inline text-slate-200">{m.deadline}</dd></div>
                <div><dt className="inline text-slate-500">Moves deal: </dt><dd className="inline text-slate-200">{m.deal_id ?? "n/a"} {m.value != null && `(${usd(m.value)})`}</dd></div>
              </dl>
              <p className="mt-1 text-xs text-slate-400">Why: {m.why}</p>
              <div className="mt-2"><Chips rs={m.receipts} open={open} /></div>
            </div>
            <button onClick={() => onDraft(m)} className="shrink-0 rounded bg-emerald-600 px-2 py-1 text-xs font-medium hover:bg-emerald-500">Draft &amp; Push Note</button>
          </div>
        </div>
      ))}
    </Card>
  );
}

export function Q4({ a, open }: P) {
  return (
    <Card n={4} title="What is about to go wrong?" sub="Red ≤14 days or already critical · Amber ≤30 days / needs a look · Green watch.">
      {!a.q4.length ? <Empty t="No risks detected in cached data." /> : a.q4.map((r) => (
        <div key={r.id} className="mb-2 rounded border border-slate-800 bg-slate-950/50 p-2">
          <div className="flex flex-wrap items-center gap-2"><Level l={r.level} /><Badge>{r.kind}</Badge>
            {r.daysLeft != null && <Badge tone={r.daysLeft <= 14 ? "red" : "amber"}>{r.daysLeft}d</Badge>}
            {r.deal_id && <span className="font-mono text-xs text-slate-500">{r.deal_id}</span>}</div>
          <p className="mt-1 text-sm">{r.title}</p>
          <p className="text-xs text-slate-400">{r.detail} · Trigger: {r.trigger ?? "no date in data"} · Turns critical: {r.turnsCritical ?? "n/a"}</p>
          <div className="mt-1"><Chips rs={r.receipts} open={open} /></div>
        </div>
      ))}
    </Card>
  );
}

export function Q5({ a, open }: P) {
  return (
    <Card n={5} title="What do you still not know?" sub="Gaps the plan rests on, why they matter, and who can fill them.">
      {a.q5.map((g) => (
        <div key={g.id} className="mb-2 rounded border border-slate-800 bg-slate-950/50 p-2">
          <p className="text-sm font-medium">{g.title}</p>
          <p className="text-xs text-slate-400">Why it matters: {g.whyItMatters}</p>
          <p className="text-xs text-slate-400">Who can fill it: <span className="text-slate-200">{g.whoCanFill.join(", ")}</span></p>
          <div className="mt-1"><Chips rs={g.receipts} open={open} /></div>
        </div>
      ))}
    </Card>
  );
}
