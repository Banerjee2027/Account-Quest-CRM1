import "server-only";
import { driver, getCached, setCached, patchMeta, getMeta } from "./store";

export const MCP_URL = "https://questathon.aihackerscollective.com/api/public/mcp";
/** Server allows 1 call/min/token. 62s gives a 2s safety margin for clock skew. */
export const SLOT_MS = 62_000;
const SLOT_KEY = "mcp-slot";

export class RateLimitedError extends Error {
  constructor(public retryAfterMs: number) {
    super(`MCP slot busy; retry in ${Math.ceil(retryAfterMs / 1000)}s`);
    this.name = "RateLimitedError";
  }
}
export class McpError extends Error {
  constructor(msg: string, public status?: number) { super(msg); this.name = "McpError"; }
}

type JsonRpc = {
  jsonrpc: "2.0"; id: number;
  result?: { content?: { type: string; text?: string }[]; isError?: boolean; structuredContent?: unknown };
  error?: { code: number; message: string; data?: unknown };
};

/** Server may answer with plain JSON or an SSE stream ("event: message\ndata: {...}"). */
async function parseBody(res: Response): Promise<JsonRpc> {
  const text = await res.text();
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("text/event-stream") || text.trimStart().startsWith("event:") || text.trimStart().startsWith("data:")) {
    const datas = text.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).filter(Boolean);
    for (let i = datas.length - 1; i >= 0; i--) {
      try { return JSON.parse(datas[i]); } catch { /* try previous */ }
    }
    throw new McpError(`Unparseable SSE body: ${text.slice(0, 200)}`, res.status);
  }
  try { return JSON.parse(text); }
  catch { throw new McpError(`Non-JSON MCP response (${res.status}): ${text.slice(0, 200)}`, res.status); }
}

/** Tool results usually arrive as content[0].text holding a JSON string. Decode it when possible. */
function unwrap(r: JsonRpc): unknown {
  if (r.error) throw new McpError(`${r.error.code}: ${r.error.message}`);
  if (r.result?.isError) {
    throw new McpError(r.result.content?.map((c) => c.text).join(" ") || "Tool reported isError");
  }
  if (r.result?.structuredContent !== undefined) return r.result.structuredContent;
  const text = r.result?.content?.filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n") ?? "";
  try { return JSON.parse(text); } catch { return text; }
}

/**
 * Low-level call. Takes the global 1/min slot BEFORE hitting the network (atomic lock in the
 * store, so concurrent serverless invocations can never double-spend the budget).
 * Throws RateLimitedError instead of blocking, so route handlers stay under Vercel time limits.
 * The token is read only here, on the server.
 */
export async function callTool<T = unknown>(toolName: string, args: Record<string, unknown> = {}): Promise<T> {
  const token = process.env.AQ_TOKEN;
  if (!token) throw new McpError("AQ_TOKEN is not set (server env)");

  const wait = await driver().claim(SLOT_KEY, SLOT_MS);
  if (wait > 0) throw new RateLimitedError(wait);

  const started = Date.now();
  await patchMeta({ lastCallAt: started, lastCallTool: toolName });
  try {
    const res = await fetch(MCP_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: "Bearer " + token,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now(),
        method: "tools/call",
        params: { name: toolName, arguments: args },
      }),
      cache: "no-store",
    });
    if (res.status === 429) throw new McpError("MCP 429 rate limited", 429); // slot stays held
    const body = await parseBody(res);
    const out = unwrap(body) as T;
    const m = await getMeta();
    await patchMeta({ lastError: null, callCount: m.callCount + 1 });
    return out;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await patchMeta({ lastError: `${toolName}: ${msg}` });
    // Network-level failure before the server saw it: free the slot so we don't waste a minute.
    if (e instanceof TypeError) await driver().release(SLOT_KEY);
    throw e;
  }
}

/** Cache-first wrapper. Never re-fetches a cached item unless force=true. */
export async function callToolCached<T = unknown>(
  toolName: string,
  args: Record<string, unknown> = {},
  opts: { force?: boolean } = {}
): Promise<{ data: T; cached: boolean; fetchedAt: number }> {
  if (!opts.force) {
    const hit = await getCached<T>(toolName, args);
    if (hit) return { data: hit.data, cached: true, fetchedAt: hit.fetchedAt };
  }
  const data = await callTool<T>(toolName, args);
  const e = await setCached(toolName, args, data);
  return { data, cached: false, fetchedAt: e.fetchedAt };
}

/** Milliseconds until the next MCP slot is free (0 = free now). Read-only; does not claim. */
export async function msUntilSlot(): Promise<number> {
  const m = await getMeta();
  if (!m.lastCallAt) return 0;
  return Math.max(0, m.lastCallAt + SLOT_MS - Date.now());
}
