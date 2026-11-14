import "server-only";
import { callTool, McpError, RateLimitedError, msUntilSlot } from "./mcp";
import { driver, getCached, setCached, getMeta, patchMeta, listNotes, updateNote } from "./store";
import { extractAccounts, ACCOUNT_NAMES, type AccKey, type Sig } from "./analyzer";

type Step = { tool: string; acct?: AccKey };
export const HYDRATION: Step[] = [
  { tool: "get_data_format" }, { tool: "get_my_accounts" },
  { tool: "get_all_paperwork", acct: "A" }, { tool: "get_all_paperwork", acct: "B" },
  { tool: "get_feature_requests" }, { tool: "get_release_notes" }, { tool: "get_flytbase_team" },
];
const LIVE = ["get_signals", "get_signals", "list_notes", "get_signals", "whoami"];

export type TickResult = { phase: "notes" | "hydrate" | "live" | "idle"; ran: string | null; waitMs: number; error?: string };
const str = (v: unknown) => (typeof v === "string" ? v : "");

async function accounts() {
  const c = await getCached("get_my_accounts", {});
  return c ? extractAccounts(c.data) : [];
}
export async function accountKeyFor(sel: string) {
  // Official sample: write_note({ account: "A", ... }) -> the account is the letter, not a name/id.
  if (sel === "A" || sel === "B") return sel;
  const a = (await accounts()).find((x) => x.key === sel || x.name === sel);
  return a?.canon ?? sel;
}
/** Arg shapes for per-account tools are not documented: try {account:key} -> {account_id:key} -> {account:name}. */
async function variants(s: Step): Promise<Record<string, unknown>[]> {
  if (!s.acct) return [{}];
  const a = (await accounts()).find((x) => x.canon === s.acct);
  const key = a?.key ?? ACCOUNT_NAMES[s.acct], name = a?.name ?? ACCOUNT_NAMES[s.acct];
  return [{ account: s.acct }, { account: key }, { account_id: key }, { account: name }];
}
export function hydrationStatus(m: { hydrateStep: number; hydrated: boolean }) {
  const s = HYDRATION[m.hydrateStep];
  return { step: m.hydrateStep, total: HYDRATION.length, done: m.hydrated, next: s ? s.tool + (s.acct ? ` (${s.acct})` : "") : null };
}

export async function mergeSignals(data: unknown) {
  const arr: unknown[] = Array.isArray(data) ? data
    : data && typeof data === "object" ? ((Object.values(data as object).find(Array.isArray) as unknown[] | undefined) ?? [data]) : data ? [data] : [];
  const log = ((await driver().get("signals-log")) as Sig[] | null) ?? [];
  const seen = new Set(log.map((x) => x.key));
  const now = Date.now();
  for (const s of arr) {
    const o = s && typeof s === "object" ? (s as Record<string, unknown>) : {};
    const key = str(o.signal_id) || str(o.id) || JSON.stringify(s);
    if (!seen.has(key)) { seen.add(key); log.push({ key, seenAt: now, signal: s }); }
  }
  await driver().set("signals-log", log.slice(-500));
  await patchMeta({ lastSignalsAt: now });
}

const wait = (ms: number): TickResult => ({ phase: "idle", ran: null, waitMs: ms });

async function sendNote(): Promise<TickResult | null> {
  const now = Date.now();
  const n = (await listNotes()).find((x) => x.status === "queued" || (x.status === "sending" && now - (x.sendingAt ?? 0) > 180_000));
  if (!n) return null;
  await updateNote(n.id, { status: "sending", sendingAt: now });
  try {
    await callTool("write_note", { account: await accountKeyFor(n.account), kind: n.kind, title: n.title, text: n.text });
    await updateNote(n.id, { status: "synced", syncedAt: Date.now(), error: undefined });
    return { phase: "notes", ran: "write_note", waitMs: 0 };
  } catch (e) {
    if (e instanceof RateLimitedError) { await updateNote(n.id, { status: "queued" }); return wait(e.retryAfterMs); }
    const msg = e instanceof Error ? e.message : String(e);
    await updateNote(n.id, { status: "failed", error: msg });
    return { phase: "notes", ran: "write_note", waitMs: 0, error: msg };
  }
}

async function hydrateStep(): Promise<TickResult | null> {
  const meta = await getMeta();
  if (meta.hydrated || meta.hydrateStep >= HYDRATION.length) return null;
  const s = HYDRATION[meta.hydrateStep];
  const fails = ((await driver().get("hydrate-fails")) as Record<string, number> | null) ?? {};
  const vs = await variants(s);
  const f = fails[meta.hydrateStep] ?? 0;
  const args = vs[Math.min(f, vs.length - 1)];
  const advance = () => patchMeta({ hydrateStep: meta.hydrateStep + 1, hydrated: meta.hydrateStep + 1 >= HYDRATION.length });
  try {
    const data = await callTool(s.tool, args);
    await setCached(s.tool, args, data);
    await advance();
    return { phase: "hydrate", ran: s.tool, waitMs: 0 };
  } catch (e) {
    if (e instanceof RateLimitedError) return wait(e.retryAfterMs);
    fails[meta.hydrateStep] = f + 1;
    await driver().set("hydrate-fails", fails);
    if (f + 1 >= vs.length) await advance(); // give up on this step, don't block the rest
    return { phase: "hydrate", ran: s.tool, waitMs: 0, error: e instanceof McpError || e instanceof Error ? e.message : String(e) };
  }
}

async function liveStep(): Promise<TickResult> {
  const rot = ((await driver().get("live-rot")) as number | null) ?? 0;
  const tool = LIVE[rot % LIVE.length];
  try {
    const data = await callTool(tool, {});
    await driver().set("live-rot", rot + 1);
    await setCached(tool, {}, data);
    if (tool === "get_signals") await mergeSignals(data);
    return { phase: "live", ran: tool, waitMs: 0 };
  } catch (e) {
    if (e instanceof RateLimitedError) return wait(e.retryAfterMs);
    await driver().set("live-rot", rot + 1);
    return { phase: "live", ran: tool, waitMs: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

/** One scheduler beat: at most ONE MCP call, only if the global slot is free. Priority: notes > hydration > live. */
export async function tick(opts: { only?: "hydrate" } = {}): Promise<TickResult> {
  const w = await msUntilSlot();
  if (w > 0) return wait(w);
  if (!opts.only) { const r = await sendNote(); if (r) return r; }
  const h = await hydrateStep();
  if (h) return h;
  if (opts.only) return wait(0);
  return liveStep();
}

/** Manual forced refresh of one tool (spends the slot). */
export async function forceFetch(tool: string, args: Record<string, unknown> = {}): Promise<TickResult> {
  try {
    const data = await callTool(tool, args);
    await setCached(tool, args, data);
    if (tool === "get_signals") await mergeSignals(data);
    return { phase: "live", ran: tool, waitMs: 0 };
  } catch (e) {
    if (e instanceof RateLimitedError) return wait(e.retryAfterMs);
    return { phase: "live", ran: tool, waitMs: 0, error: e instanceof Error ? e.message : String(e) };
  }
}
