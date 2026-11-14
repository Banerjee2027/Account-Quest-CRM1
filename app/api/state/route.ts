import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
import { driver, getMeta, listCached, listNotes, type Meta } from "@/lib/store";
import { msUntilSlot } from "@/lib/mcp";
import { hydrationStatus } from "@/lib/plan";
import { analyze, type Sig } from "@/lib/analyzer";

/** DB-only. Never calls the MCP. Safe to poll every 5s. */
export async function GET(req: Request) {
  const debug = new URL(req.url).searchParams.get("debug") === "1";
  const [meta, entries, notes, sigs, waitMs] = await Promise.all([
    getMeta(), listCached(), listNotes(),
    driver().get("signals-log") as Promise<Sig[] | null>, msUntilSlot(),
  ]);
  const signals = sigs ?? [];
  const analysis = analyze({ entries, signals, notes });
  return NextResponse.json({
    now: Date.now(), store: driver().name, tokenSet: !!process.env.AQ_TOKEN, meta: meta as Meta, waitMs,
    hydration: hydrationStatus(meta), analysis, notes,
    signals: signals.slice(-50).reverse(),
    cached: entries.map((e) => ({ tool: e.tool, args: e.args, fetchedAt: e.fetchedAt })),
    ...(debug ? { raw: Object.fromEntries(entries.map((e) => [e.tool + JSON.stringify(e.args), e.data])) } : {}),
  });
}
