import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
import { getMeta } from "@/lib/store";
import { tick, hydrationStatus, forceFetch } from "@/lib/plan";
export async function GET() { return NextResponse.json(hydrationStatus(await getMeta())); }
/** POST {} -> next hydration step if slot free. POST {force:true, tool, args?} -> refetch one tool. */
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  if (b?.force && typeof b.tool === "string") return NextResponse.json(await forceFetch(b.tool, b.args && typeof b.args === "object" ? b.args : {}));
  return NextResponse.json({ ...(await tick({ only: "hydrate" })), status: hydrationStatus(await getMeta()) });
}
