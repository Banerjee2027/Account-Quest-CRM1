import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
import { tick } from "@/lib/plan";
/** Client pings this ~every 15s. Makes at most one MCP call, only if the 1/min slot is free. */
export async function GET() { return NextResponse.json(await tick()); }
export const POST = GET;
