import "server-only";
import { promises as fs } from "fs";

/**
 * Persistence layer. Driver auto-selected once per process:
 *   1. Upstash Redis / Vercel KV (REST)  -> persists across serverless invocations  (RECOMMENDED)
 *   2. JSON file in /tmp                 -> persists across warm lambdas only
 *   3. In-memory                         -> dev / last resort
 * No npm deps: Upstash is spoken to over its REST API with fetch.
 */

type Json = unknown;
interface Driver {
  name: "upstash" | "file" | "memory";
  get(k: string): Promise<Json | null>;
  set(k: string, v: Json): Promise<void>;
  del(k: string): Promise<void>;
  keys(prefix: string): Promise<string[]>;
  /** Try to take a time-lock. Returns 0 if acquired, else ms until it frees up. */
  claim(k: string, ttlMs: number): Promise<number>;
  /** Release a lock early (used when a call failed before reaching the server). */
  release(k: string): Promise<void>;
}

const NS = "aq:";

// ---------- Upstash / Vercel KV (REST) ----------
function upstash(url: string, token: string): Driver {
  const cmd = async (args: (string | number)[]) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(args),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`KV ${res.status}: ${await res.text()}`);
    return ((await res.json()) as { result: any }).result;
  };
  return {
    name: "upstash",
    async get(k) {
      const r = await cmd(["GET", NS + k]);
      return r == null ? null : JSON.parse(r);
    },
    async set(k, v) { await cmd(["SET", NS + k, JSON.stringify(v)]); },
    async del(k) { await cmd(["DEL", NS + k]); },
    async keys(p) {
      const r: string[] = await cmd(["KEYS", `${NS}${p}*`]);
      return r.map((x) => x.slice(NS.length));
    },
    async claim(k, ttl) {
      const ok = await cmd(["SET", `${NS}lock:${k}`, Date.now(), "NX", "PX", ttl]);
      if (ok === "OK") return 0;
      const left = await cmd(["PTTL", `${NS}lock:${k}`]);
      return Math.max(Number(left) || 1000, 1000);
    },
    async release(k) { await cmd(["DEL", `${NS}lock:${k}`]); },
  };
}

// ---------- File (/tmp) and Memory ----------
type Blob = { data: Record<string, Json>; locks: Record<string, number> };
const g = globalThis as unknown as { __aqMem?: Blob };

function blobDriver(kind: "file" | "memory"): Driver {
  const FILE = process.env.AQ_STORE_FILE || "/tmp/aq-store.json";
  const load = async (): Promise<Blob> => {
    if (kind === "memory") return (g.__aqMem ??= { data: {}, locks: {} });
    try { return JSON.parse(await fs.readFile(FILE, "utf8")); }
    catch { return { data: {}, locks: {} }; }
  };
  const save = async (b: Blob) => {
    if (kind === "memory") { g.__aqMem = b; return; }
    await fs.writeFile(FILE, JSON.stringify(b));
  };
  return {
    name: kind,
    async get(k) { return (await load()).data[k] ?? null; },
    async set(k, v) { const b = await load(); b.data[k] = v; await save(b); },
    async del(k) { const b = await load(); delete b.data[k]; await save(b); },
    async keys(p) { return Object.keys((await load()).data).filter((x) => x.startsWith(p)); },
    async claim(k, ttl) {
      const b = await load();
      const left = (b.locks[k] ?? 0) - Date.now();
      if (left > 0) return left;
      b.locks[k] = Date.now() + ttl;
      await save(b);
      return 0;
    },
    async release(k) { const b = await load(); delete b.locks[k]; await save(b); },
  };
}

let _driver: Driver | null = null;
export function driver(): Driver {
  if (_driver) return _driver;
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (url && token) return (_driver = upstash(url, token));
  if (process.env.VERCEL || process.env.AQ_STORE_FILE || process.env.NODE_ENV !== "production")
    return (_driver = blobDriver("file"));
  return (_driver = blobDriver("memory"));
}

// ---------- Typed helpers ----------
export type CacheEntry<T = unknown> = { tool: string; args: Record<string, unknown>; data: T; fetchedAt: number };

const stable = (o: unknown): string =>
  JSON.stringify(o, (_k, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as object).sort(([a], [b]) => a.localeCompare(b)))
      : v
  );
export const cacheKey = (tool: string, args: Record<string, unknown> = {}) =>
  `cache:${tool}:${stable(args)}`;

export async function getCached<T = unknown>(tool: string, args: Record<string, unknown> = {}) {
  return (await driver().get(cacheKey(tool, args))) as CacheEntry<T> | null;
}
export async function setCached(tool: string, args: Record<string, unknown>, data: unknown) {
  const e: CacheEntry = { tool, args, data, fetchedAt: Date.now() };
  await driver().set(cacheKey(tool, args), e);
  return e;
}
export async function listCached(): Promise<CacheEntry[]> {
  const d = driver();
  const ks = await d.keys("cache:");
  const all = await Promise.all(ks.map((k) => d.get(k)));
  return all.filter(Boolean) as CacheEntry[];
}

// --- Meta: scheduler/hydration bookkeeping shown in the status bar ---
export type Meta = {
  /** Index into HYDRATION_PLAN of the next step to run (Phase 2 defines the plan). */
  hydrateStep: number;
  hydrated: boolean;
  lastCallAt: number | null;
  lastCallTool: string | null;
  lastSignalsAt: number | null;
  lastError: string | null;
  callCount: number;
};
const META0: Meta = {
  hydrateStep: 0, hydrated: false, lastCallAt: null, lastCallTool: null,
  lastSignalsAt: null, lastError: null, callCount: 0,
};
export async function getMeta(): Promise<Meta> {
  return { ...META0, ...(((await driver().get("meta")) as Partial<Meta>) ?? {}) };
}
export async function patchMeta(p: Partial<Meta>): Promise<Meta> {
  const m = { ...(await getMeta()), ...p };
  await driver().set("meta", m);
  return m;
}

// --- Notes: write-back queue (status flows queued -> sending -> synced | failed) ---
export type NoteKind = "note" | "task" | "risk" | "next_step";
export type NoteStatus = "queued" | "sending" | "synced" | "failed";
export type Note = {
  id: string;
  account: string;
  kind: NoteKind | string;
  title: string;
  text: string;
  status: NoteStatus;
  createdAt: number;
  syncedAt?: number;
  sendingAt?: number;
  error?: string;
  /** Receipts (person_id / deal_id / fact_id / file_id / path) this note is based on. */
  refs?: string[];
};
export async function listNotes(): Promise<Note[]> {
  return ((await driver().get("notes")) as Note[] | null) ?? [];
}
export async function addNote(n: Omit<Note, "id" | "status" | "createdAt">): Promise<Note> {
  const note: Note = {
    ...n,
    id: `n_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    status: "queued",
    createdAt: Date.now(),
  };
  await driver().set("notes", [...(await listNotes()), note]);
  return note;
}
export async function updateNote(id: string, patch: Partial<Note>): Promise<Note | null> {
  const all = await listNotes();
  const i = all.findIndex((n) => n.id === id);
  if (i < 0) return null;
  all[i] = { ...all[i], ...patch };
  await driver().set("notes", all);
  return all[i];
}

/** Wipe everything (manual "force re-hydrate"). */
export async function resetAll() {
  const d = driver();
  for (const k of await d.keys("")) await d.del(k);
}
