import type { CacheEntry, Note } from "./store";

/**
 * Deterministic analysis engine. NO LLM, NO invented data.
 * Every output row carries Receipts (person_id / deal_id / fact_id / file_id / paperwork path / signal).
 * Schema knowledge is isolated in the alias lists + walk() below: the real MCP payload shape was NOT
 * known when written, so tighten these after inspecting /api/state?debug=1 (see schema fingerprint).
 */
export type Rec = Record<string, unknown>;
export type AccKey = "A" | "B";
export type Prov = "verified" | "told" | "claim";
export type Receipt = { id: string; kind: string; excerpt?: string; prov?: Prov | null };
export const ACCOUNT_NAMES: Record<AccKey, string> = { A: "Eastern Counties Police Alliance", B: "Aldermoor Industrial Group" };
const RE: Record<AccKey, RegExp> = { A: /eastern counties/i, B: /aldermoor/i };
const VK = ["value", "amount", "value_usd", "deal_value", "arr", "acv", "worth", "value_gbp"];

const str = (v: unknown): string => (v == null ? "" : typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : "");
const pick = (r: Rec, ...ks: string[]) => { for (const k of ks) if (r[k] != null && r[k] !== "") return r[k]; return undefined; };
const has = (r: Rec, k: string) => r[k] != null && r[k] !== "";
const clip = (s: string, n = 200) => (s.length > n ? s.slice(0, n) + "…" : s);
const hash = (s: string) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };

function money(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (typeof v !== "string") return null;
  const m = v.replace(/,/g, "").match(/(-?\d+(?:\.\d+)?)\s*([kKmM])?/);
  if (!m) return null;
  return parseFloat(m[1]) * (m[2] ? (/k/i.test(m[2]) ? 1e3 : 1e6) : 1);
}
const MON = "jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec";
const mi = (s: string) => ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(s.slice(0, 3).toLowerCase());
function parseDate(t: string, now: Date): Date | null {
  let m = t.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  let mon = -1, day = 0, yr = 0;
  m = t.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MON})[a-z]*\\.?(?:,?\\s+(20\\d{2}))?`, "i"));
  if (m) { day = +m[1]; mon = mi(m[2]); yr = m[3] ? +m[3] : 0; }
  else {
    m = t.match(new RegExp(`\\b(${MON})[a-z]*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(20\\d{2}))?`, "i"));
    if (!m) return null;
    mon = mi(m[1]); day = +m[2]; yr = m[3] ? +m[3] : 0;
  }
  if (day < 1 || day > 31) return null;
  let y = yr || now.getUTCFullYear();
  let d = new Date(Date.UTC(y, mon, day));
  if (!yr && d.getTime() < now.getTime() - 30 * 864e5) d = new Date(Date.UTC(y + 1, mon, day));
  return d;
}
function parseMonthOnly(t: string, now: Date): Date | null {
  const m = t.match(new RegExp(`\\b(${MON})[a-z]*\\b`, "i"));
  if (!m) return null;
  let d = new Date(Date.UTC(now.getUTCFullYear(), mi(m[1]), 1));
  if (d.getTime() < now.getTime() - 30 * 864e5) d = new Date(Date.UTC(now.getUTCFullYear() + 1, mi(m[1]), 1));
  return d;
}
const daysTo = (d: Date, now: Date) => Math.ceil((d.getTime() - now.getTime()) / 864e5);
const iso = (d: Date) => d.toISOString().slice(0, 10);

/* ---------- Accounts ---------- */
export type AccountRef = { key: string; name: string; canon: AccKey };
export function extractAccounts(data: unknown): AccountRef[] {
  const out: AccountRef[] = []; const seen = new Set<string>();
  const visit = (n: unknown, d: number) => {
    if (d > 8 || n == null) return;
    if (Array.isArray(n)) { n.forEach((x) => visit(x, d + 1)); return; }
    if (typeof n !== "object") return;
    const r = n as Rec;
    const name = str(pick(r, "name", "account_name", "title"));
    const key = str(pick(r, "account_id", "id", "account", "slug")) || name;
    const canon: AccKey | null = RE.A.test(name) ? "A" : RE.B.test(name) ? "B" : null;
    if (canon && key && !seen.has(canon)) { seen.add(canon); out.push({ key, name, canon }); return; }
    Object.values(r).forEach((x) => visit(x, d + 1));
  };
  visit(data, 0);
  if (!out.length && typeof data === "string") (["A", "B"] as AccKey[]).forEach((k) => RE[k].test(data) && out.push({ key: ACCOUNT_NAMES[k], name: ACCOUNT_NAMES[k], canon: k }));
  return out;
}

/* ---------- Collection ---------- */
type Item = { r: Rec; acc?: AccKey; tool: string };
type Bag = { deals: Item[]; people: Item[]; facts: Item[]; files: Item[]; links: Item[]; paper: Item[]; team: Item[] };
const textOf = (r: Rec) => str(pick(r, "content", "text", "body", "markdown", "contents"));

function collect(entries: CacheEntry[], map: Map<string, AccKey>): Bag {
  const bag: Bag = { deals: [], people: [], facts: [], files: [], links: [], paper: [], team: [] };
  const toAcc = (s: string): AccKey | undefined => (!s ? undefined : map.get(s) ?? (RE.A.test(s) ? "A" : RE.B.test(s) ? "B" : undefined));
  const walk = (n: unknown, ctx: { acc?: AccKey; tool: string }, d: number) => {
    if (d > 14 || n == null || typeof n !== "object") return;
    if (Array.isArray(n)) { n.forEach((x) => walk(x, ctx, d + 1)); return; }
    const r = n as Rec;
    const isRec = ["fact_id", "deal_id", "person_id", "file_id", "path"].some((k) => has(r, k));
    const own = toAcc(str(pick(r, "account_id", "account", "account_name")));
    const nm = !isRec ? toAcc(str(pick(r, "name", "account_name"))) : undefined;
    const c = { ...ctx, acc: own ?? nm ?? ctx.acc };
    const acc = c.acc ?? (isRec ? toAcc(clip(JSON.stringify(r), 1500)) : undefined);
    const it: Item = { r, acc, tool: ctx.tool };
    if (ctx.tool === "get_flytbase_team") { if (has(r, "name")) bag.team.push(it); }
    else if (has(r, "fact_id")) bag.facts.push(it);
    else if (has(r, "deal_id") && (has(r, "stage") || VK.some((k) => has(r, k)))) bag.deals.push(it);
    else if (has(r, "deal_id") && has(r, "person_id")) bag.links.push(it);
    else if (has(r, "deal_id")) bag.deals.push(it);
    else if (has(r, "person_id")) bag.people.push(it);
    else if (has(r, "file_id") || has(r, "path")) (textOf(r) ? bag.paper : bag.files).push(it);
    else if (ctx.tool === "get_flytbase_team" && has(r, "name")) bag.team.push(it);
    Object.values(r).forEach((v) => walk(v, c, d + 1));
  };
  for (const e of entries) {
    const acc = toAcc(str(pick(e.args as Rec, "account", "account_id", "account_name")));
    if (typeof e.data === "string") {
      if (e.tool === "get_all_paperwork") bag.paper.push({ r: { path: `${e.tool}${acc ? ":" + acc : ""}`, content: e.data }, acc, tool: e.tool });
      continue;
    }
    walk(e.data, { acc, tool: e.tool }, 0);
  }
  return bag;
}
function uniq(items: Item[], idk: string): Item[] {
  const m = new Map<string, Item>();
  for (const it of items) {
    const id = str(it.r[idk]);
    const old = m.get(id);
    m.set(id, old ? { r: { ...old.r, ...it.r }, acc: old.acc ?? it.acc, tool: old.tool } : it);
  }
  return [...m.values()];
}

/* ---------- Helpers ---------- */
function provOf(r: Rec): Prov | null {
  const raw = str(pick(r, "provenance", "source_type", "basis", "evidence", "status", "confidence")).toLowerCase();
  if (r.verified === true) return "verified";
  if (!raw) return has(r, "file_id") ? "verified" : null;
  if (/unverif|claim|assum|estimate/.test(raw)) return "claim";
  if (/told|said|verbal|stated|reported/.test(raw)) return "told";
  if (/verif|confirm|document|file|signed/.test(raw)) return "verified";
  return null;
}
const factText = (r: Rec) => str(pick(r, "text", "statement", "claim", "note", "summary", "description", "content"));
const personName = (r: Rec) => str(pick(r, "name", "full_name", "person_name")) || str(r.person_id);
type Role = "Decider" | "Payer" | "User / Champion" | "Potential Blocker";
const ROLES: Role[] = ["Decider", "Payer", "User / Champion", "Potential Blocker"];
function rolesOf(t: string): Role[] {
  const x = t.toLowerCase(); const out: Role[] = [];
  if (/decid|approv|sign[- ]?off|authori[sz]|final say|economic buyer/.test(x)) out.push("Decider");
  if (/pay|budget|financ|procure|purchas|holder of the purse|cfo/.test(x)) out.push("Payer");
  if (/user|champion|operator|sponsor|pilot|advocate|programme lead|program lead/.test(x)) out.push("User / Champion");
  if (/block|sceptic|skeptic|oppos|resist|veto|risk/.test(x)) out.push("Potential Blocker");
  return out;
}

/* ---------- Output types ---------- */
export type DealRow = { deal_id: string; name: string; value: number | null; stage: string; backed: boolean; prov: Prov; why: string; receipts: Receipt[] };
export type PowerRow = { deal_id: string; deal: string; roles: Record<Role, { person_id: string; name: string; stance: string; receipts: Receipt[] }[]>; missing: Role[]; singleThreaded: boolean; flags: string[] };
export type Risk = { id: string; level: "red" | "amber" | "green"; kind: string; title: string; detail: string; trigger: string | null; turnsCritical: string | null; daysLeft: number | null; deal_id?: string; receipts: Receipt[] };
export type Move = { rank: number; title: string; deal_id: string | null; owner: string; deadline: string; why: string; value: number | null; receipts: Receipt[]; draft: { kind: "next_step"; title: string; text: string; refs: string[] } };
export type Gap = { id: string; title: string; whyItMatters: string; whoCanFill: string[]; receipts: Receipt[] };
export type AccountAnalysis = {
  key: AccKey; name: string;
  q1: { deals: DealRow[]; backedTotal: number; unbackedTotal: number; unvaluedCount: number };
  q2: PowerRow[]; q3: Move[]; q4: Risk[]; q5: Gap[];
};
export type Sig = { key: string; seenAt: number; signal: unknown };
export type Analysis = {
  generatedAt: string; accounts: Record<AccKey, AccountAnalysis>;
  overview: { key: AccKey; name: string; backed: number; unbacked: number; reds: number; ambers: number; gaps: number; topMove: string | null }[];
  schema: Record<string, string[]>; counts: Record<string, number>; warnings: string[];
};

/* ---------- Per-account engine ---------- */
function build(k: AccKey, bag: Bag, sigs: Sig[], now: Date, map: Map<string, AccKey>): AccountAnalysis {
  const f = (xs: Item[]) => xs.filter((i) => i.acc === k);
  const deals = uniq(f(bag.deals), "deal_id"), facts = uniq(f(bag.facts), "fact_id"), people = uniq(f(bag.people), "person_id");
  const links = f(bag.links), paper = f(bag.paper), team = bag.team;
  const pById = new Map(people.map((p) => [str(p.r.person_id), p.r]));
  const dealOf = (text: string) => deals.find((d) => text.includes(str(d.r.deal_id)) || (str(pick(d.r, "name", "title")).length > 3 && text.toLowerCase().includes(str(pick(d.r, "name", "title")).toLowerCase())));

  // ---- Q1
  const rows: DealRow[] = deals.map((d) => {
    const id = str(d.r.deal_id); const value = money(pick(d.r, ...VK));
    const fs = facts.filter((x) => str(x.r.deal_id) === id);
    const receipts: Receipt[] = [{ id, kind: "deal_id", excerpt: clip(JSON.stringify(d.r), 160), prov: provOf(d.r) }];
    fs.forEach((x) => {
      receipts.push({ id: str(x.r.fact_id), kind: "fact_id", excerpt: clip(factText(x.r)), prov: provOf(x.r) });
      if (has(x.r, "file_id")) receipts.push({ id: str(x.r.file_id), kind: "file_id" });
    });
    if (has(d.r, "file_id")) receipts.push({ id: str(d.r.file_id), kind: "file_id" });
    const own = provOf(d.r);
    const amountHit = (x: Item) => value != null && (money(pick(x.r, ...VK)) === value || factText(x.r).replace(/,/g, "").includes(String(value)));
    const backed = own === "verified" || has(d.r, "file_id") || fs.some((x) => provOf(x.r) === "verified" && amountHit(x));
    const prov: Prov = backed ? "verified" : own ?? (fs.some((x) => provOf(x.r) === "told") ? "told" : "claim");
    return {
      deal_id: id, name: str(pick(d.r, "name", "title", "deal_name")) || id, value,
      stage: str(pick(d.r, "stage", "status")).toLowerCase() || "unknown", backed, prov,
      why: backed ? "Verified by a record on file" : `Not backed by a file: ${prov === "told" ? "told by a person" : "claim on the account sheet"}`, receipts,
    };
  }).sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  const sum = (b: boolean) => rows.filter((r) => r.backed === b).reduce((s, r) => s + (r.value ?? 0), 0);

  // ---- Q2
  const power: PowerRow[] = deals.map((d) => {
    const id = str(d.r.deal_id);
    const mem = new Map<string, string>();
    links.filter((l) => str(l.r.deal_id) === id).forEach((l) => mem.set(str(l.r.person_id), str(pick(l.r, "role", "stakeholder_role", "title")) + " " + str(pick(l.r, "notes", "note"))));
    for (const key of ["people", "stakeholders", "contacts"]) {
      const a = d.r[key];
      if (Array.isArray(a)) a.forEach((x) => typeof x === "string" ? mem.set(x, mem.get(x) ?? "") : x && typeof x === "object" && has(x as Rec, "person_id") && mem.set(str((x as Rec).person_id), str(pick(x as Rec, "role", "title"))));
    }
    people.forEach((p) => { const ds = p.r.deals ?? p.r.deal_ids; if (Array.isArray(ds) && ds.map(str).includes(id) && !mem.has(str(p.r.person_id))) mem.set(str(p.r.person_id), ""); });
    const roles = Object.fromEntries(ROLES.map((r) => [r, []])) as unknown as PowerRow["roles"];
    mem.forEach((linkText, pid) => {
      const p = pById.get(pid) ?? {};
      const rs = rolesOf(`${linkText} ${str(pick(p, "role", "title", "job_title"))}`);
      const entry = { person_id: pid, name: personName({ ...p, person_id: pid }), stance: str(pick(p, "stance", "attitude", "sentiment")).toLowerCase() || "unknown", receipts: [{ id: pid, kind: "person_id", excerpt: clip(str(pick(p, "title", "role", "notes")) || linkText) }] as Receipt[] };
      rs.forEach((r) => roles[r].push(entry));
    });
    const missing = ROLES.filter((r) => r !== "Potential Blocker" && !roles[r].length);
    const flags = missing.map((r) => `No ${r} identified on record for this deal`);
    if (mem.size <= 1) flags.push(`Single-threaded: ${mem.size} contact on record`);
    return { deal_id: id, deal: str(pick(d.r, "name", "title")) || id, roles, missing, singleThreaded: mem.size <= 1, flags };
  });

  // ---- text units for risk detection (each keeps its receipts)
  type U = { text: string; receipts: Receipt[]; deal?: string };
  const units: U[] = [];
  facts.forEach((x) => { const rc: Receipt[] = [{ id: str(x.r.fact_id), kind: "fact_id", excerpt: clip(factText(x.r)), prov: provOf(x.r) }]; ["file_id", "person_id", "deal_id"].forEach((q) => has(x.r, q) && rc.push({ id: str(x.r[q]), kind: q })); units.push({ text: factText(x.r), receipts: rc, deal: str(x.r.deal_id) || undefined }); });
  people.forEach((p) => { const t = str(pick(p.r, "notes", "note", "status_note", "summary")); if (t) units.push({ text: t, receipts: [{ id: str(p.r.person_id), kind: "person_id", excerpt: clip(t) }] }); });
  paper.forEach((p) => textOf(p.r).split(/\r?\n/).slice(0, 4000).forEach((ln) => { if (ln.trim().length > 12) units.push({ text: ln, receipts: [{ id: str(pick(p.r, "path", "file_id")), kind: has(p.r, "path") ? "path" : "file_id", excerpt: clip(ln) }] }); }));
  sigs.forEach((s) => {
    const r = (s.signal && typeof s.signal === "object" ? s.signal : {}) as Rec; const json = typeof s.signal === "string" ? s.signal : JSON.stringify(s.signal);
    const text = typeof s.signal === "string" ? s.signal : str(pick(r, "text", "message", "description", "summary", "title", "detail")) || json;
    const a = map.get(str(pick(r, "account_id", "account", "account_name"))) ?? (RE.A.test(json) ? "A" : RE.B.test(json) ? "B" : undefined);
    if (a !== k) return;
    const rc: Receipt[] = [{ id: str(pick(r, "signal_id", "id")) || `signal:${s.key.slice(0, 8)}`, kind: "signal", excerpt: clip(text) }];
    ["person_id", "deal_id"].forEach((q) => has(r, q) && rc.push({ id: str(r[q]), kind: q }));
    units.push({ text, receipts: rc, deal: str(r.deal_id) || undefined });
  });

  // ---- Q4
  const risks = new Map<string, Risk>();
  const add = (r: Omit<Risk, "id">) => { const id = hash(r.kind + r.title.slice(0, 90)); if (!risks.has(id)) risks.set(id, { id, ...r }); };
  const lvl = (d: number): Risk["level"] => (d <= 14 ? "red" : d <= 30 ? "amber" : "green");
  for (const u of units) {
    const dl = u.deal ?? dealOf(u.text)?.r.deal_id as string | undefined;
    const dealId = dl ? str(dl) : undefined;
    if (/(deadline|due|event|training|failover|go-?live|renew|expires?|launch|demo|support in writing)/i.test(u.text)) {
      const d = parseDate(u.text, now);
      if (d) { const n = daysTo(d, now); if (n > -14 && n <= 75) add({ level: n < 0 ? "red" : lvl(n), kind: "deadline", title: clip(u.text, 120), detail: n < 0 ? `Date passed ${-n}d ago` : `${n}d remaining`, trigger: iso(d), turnsCritical: n <= 14 ? "Already critical" : iso(new Date(d.getTime() - 14 * 864e5)), daysLeft: n, deal_id: dealId, receipts: u.receipts }); }
    }
    if (/(leav|depart|resign|notice period|moving on|retir|last day)/i.test(u.text)) {
      const exact = parseDate(u.text, now); const d = exact ?? parseMonthOnly(u.text, now); const n = d ? daysTo(d, now) : null;
      add({ level: n != null && n <= 60 ? "red" : "amber", kind: "departure", title: clip(u.text, 120), detail: "Key person departing; check for a named successor", trigger: d ? (exact ? iso(d) : `${iso(d).slice(0, 7)} (month only)`) : null, turnsCritical: d ? iso(new Date(d.getTime() - 30 * 864e5)) : null, daysLeft: n, deal_id: dealId, receipts: u.receipts });
    }
    if (/((zero|no|0)\s+(flights?|usage|activity|logins?)|dropped to zero|usage (drop|fell|declin)|stopped (flying|using))/i.test(u.text)) {
      const silent = /(no ticket|not raised|no support|nobody (has )?(raised|flagged)|unreported)/i.test(u.text);
      const d = parseDate(u.text, now);
      add({ level: silent ? "red" : "amber", kind: "usage", title: clip(u.text, 120), detail: silent ? "Usage drop with no ticket raised" : "Usage drop detected; confirm cause", trigger: d ? iso(d) : null, turnsCritical: "Critical now if cause unknown", daysLeft: d ? daysTo(d, now) : null, deal_id: dealId, receipts: u.receipts });
    }
    if (/(gone quiet|gone cold|unresponsive|not replied|no response|stopped replying)/i.test(u.text)) add({ level: "amber", kind: "cold", title: clip(u.text, 120), detail: "Contact going cold", trigger: null, turnsCritical: null, daysLeft: null, deal_id: dealId, receipts: u.receipts });
  }
  people.forEach((p) => {
    const lc = str(pick(p.r, "last_contact", "last_contacted", "last_touch", "last_seen")); const d = lc ? parseDate(lc, now) : null;
    if (d) { const ago = -daysTo(d, now); if (ago > 30) add({ level: ago > 60 ? "red" : "amber", kind: "cold", title: `${personName(p.r)}: no contact for ${ago}d`, detail: `Last contact ${iso(d)}`, trigger: iso(d), turnsCritical: ago > 60 ? "Already critical" : iso(new Date(d.getTime() + 60 * 864e5)), daysLeft: null, receipts: [{ id: str(p.r.person_id), kind: "person_id", excerpt: lc }] }); }
  });
  const order = { red: 0, amber: 1, green: 2 };
  const q4 = [...risks.values()].sort((a, b) => order[a.level] - order[b.level] || (a.daysLeft ?? 999) - (b.daysLeft ?? 999));

  // ---- Q3
  const owner = (id: string | null) => { const d = deals.find((x) => str(x.r.deal_id) === id); return str(pick(d?.r ?? {}, "owner", "owner_name", "rep", "account_owner")) || "UNASSIGNED (no owner in data - assign before sending)"; };
  const cand: (Move & { score: number })[] = [];
  const valueOf = (id: string | null) => rows.find((r) => r.deal_id === id)?.value ?? null;
  q4.filter((r) => r.level !== "green").forEach((r) => {
    const v = valueOf(r.deal_id ?? null);
    const title = r.kind === "departure" ? `Secure successor / handover for departing contact` : r.kind === "usage" ? `Investigate and raise ticket for usage drop` : r.kind === "deadline" ? `Lock in written commitments before deadline` : `Re-engage cold contact`;
    cand.push({ rank: 0, title: `${title}: ${clip(r.title, 70)}`, deal_id: r.deal_id ?? null, owner: owner(r.deal_id ?? null), deadline: r.trigger ?? "No hard date in data", why: `${r.detail}. ${r.level.toUpperCase()} risk.`, value: v, receipts: r.receipts, score: (v ?? 0) / 1e4 + (r.daysLeft != null ? Math.max(0, 60 - r.daysLeft) : 10) + (r.level === "red" ? 50 : 20), draft: { kind: "next_step", title: "", text: "", refs: [] } });
  });
  power.forEach((p) => p.missing.slice(0, 1).forEach((m) => {
    const v = valueOf(p.deal_id);
    cand.push({ rank: 0, title: `Identify and meet the ${m} on ${p.deal}`, deal_id: p.deal_id, owner: owner(p.deal_id), deadline: "No hard date in data", why: `No ${m} on record for this deal`, value: v, receipts: [{ id: p.deal_id, kind: "deal_id" }], score: (v ?? 0) / 1e4 + 15, draft: { kind: "next_step", title: "", text: "", refs: [] } });
  }));
  cand.sort((a, b) => b.score - a.score);
  const q3: Move[] = cand.slice(0, 3).map((m, i) => {
    const refs = m.receipts.map((r) => r.id);
    return { ...m, rank: i + 1, draft: { kind: "next_step", title: clip(m.title, 100), text: `${m.title}\nOwner: ${m.owner}\nDeadline: ${m.deadline}\nWhy: ${m.why}\nEvidence: ${refs.join(", ")}`, refs } };
  });

  // ---- Q5
  const teamNames = team.slice(0, 3).map((t) => `${personName(t.r)} (FlytBase)`);
  const fill = (ids: string[]) => ids.length ? ids.map((i) => `person_id ${i}`) : teamNames.length ? teamNames : ["FlytBase account team"];
  const gaps: Gap[] = [];
  rows.filter((r) => !r.backed).forEach((r) => gaps.push({ id: `g-${r.deal_id}`, title: `${r.name}: ${r.value ?? "value unknown"} is ${r.prov}, not verified`, whyItMatters: "Counted as Unbacked in the book; could be overstated or lost", whoCanFill: fill(facts.filter((x) => str(x.r.deal_id) === r.deal_id && has(x.r, "person_id")).map((x) => str(x.r.person_id))), receipts: r.receipts }));
  power.forEach((p) => p.missing.forEach((m) => gaps.push({ id: `g-${p.deal_id}-${m}`, title: `${p.deal}: no ${m} on record`, whyItMatters: `Can't close or protect a deal without knowing who the ${m} is`, whoCanFill: fill(Object.values(p.roles).flat().map((x) => x.person_id)), receipts: [{ id: p.deal_id, kind: "deal_id" }] })));
  q4.filter((r) => r.kind === "usage").forEach((r) => gaps.push({ id: `g-${r.id}`, title: `Cause of usage drop unknown: ${clip(r.title, 80)}`, whyItMatters: "Silent churn signal; no ticket means nobody is investigating", whoCanFill: fill(r.receipts.filter((x) => x.kind === "person_id").map((x) => x.id)), receipts: r.receipts }));
  q4.filter((r) => r.kind === "departure").forEach((r) => { if (!units.some((u) => /(successor|replacement|handover|hand-over|takes over|taking over)/i.test(u.text))) gaps.push({ id: `g-${r.id}`, title: `No named successor: ${clip(r.title, 80)}`, whyItMatters: "Single-thread risk: relationship leaves with the person", whoCanFill: fill(r.receipts.filter((x) => x.kind === "person_id").map((x) => x.id)), receipts: r.receipts }); });
  gaps.push({ id: "g-undiscovered", title: "Deals not on the account sheet are unknown", whyItMatters: "Book only covers deals present in MCP data; expansion or competing deals may exist", whoCanFill: teamNames.length ? teamNames : ["FlytBase account team"], receipts: [] });

  return { key: k, name: ACCOUNT_NAMES[k], q1: { deals: rows, backedTotal: sum(true), unbackedTotal: sum(false), unvaluedCount: rows.filter((r) => r.value == null).length }, q2: power, q3, q4, q5: gaps };
}

export function analyze(input: { entries: CacheEntry[]; signals: Sig[]; notes?: Note[]; now?: Date }): Analysis {
  const now = input.now ?? new Date();
  const acctEntry = input.entries.find((e) => e.tool === "get_my_accounts");
  const map = new Map<string, AccKey>();
  extractAccounts(acctEntry?.data).forEach((a) => { map.set(a.key, a.canon); map.set(a.name, a.canon); });
  const bag = collect(input.entries, map);
  const keys: AccKey[] = ["A", "B"];
  const accounts = Object.fromEntries(keys.map((k) => [k, build(k, bag, input.signals, now, map)])) as Record<AccKey, AccountAnalysis>;
  const schema: Record<string, string[]> = {};
  (Object.keys(bag) as (keyof Bag)[]).forEach((c) => { schema[c] = [...new Set(bag[c].flatMap((i) => Object.keys(i.r)))].slice(0, 40); });
  const warnings: string[] = [];
  const unassigned = [...bag.deals, ...bag.facts, ...bag.people].filter((i) => !i.acc).length;
  if (unassigned) warnings.push(`${unassigned} records could not be assigned to an account and are excluded`);
  if (!acctEntry) warnings.push("get_my_accounts not hydrated yet");
  return {
    generatedAt: now.toISOString(), accounts, schema,
    counts: Object.fromEntries((Object.keys(bag) as (keyof Bag)[]).map((c) => [c, bag[c].length])), warnings,
    overview: keys.map((k) => { const a = accounts[k]; return { key: k, name: a.name, backed: a.q1.backedTotal, unbacked: a.q1.unbackedTotal, reds: a.q4.filter((r) => r.level === "red").length, ambers: a.q4.filter((r) => r.level === "amber").length, gaps: a.q5.length, topMove: a.q3[0]?.title ?? null }; }),
  };
}
