import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
import { addNote, listNotes, updateNote } from "@/lib/store";
const KINDS = ["note", "task", "risk", "next_step"];
export async function GET() { return NextResponse.json(await listNotes()); }
/** POST {account, kind, title, text, refs?} -> queued immediately; synced on a free slot by /api/live-poll. POST {retry:id} re-queues a failed note. */
export async function POST(req: Request) {
  const b = await req.json().catch(() => null);
  if (!b || typeof b !== "object") return NextResponse.json({ error: "bad json" }, { status: 400 });
  if (typeof b.retry === "string") return NextResponse.json(await updateNote(b.retry, { status: "queued", error: undefined }));
  const { account, kind, title, text } = b;
  if (![account, title, text].every((x) => typeof x === "string" && x.trim()) || !KINDS.includes(kind))
    return NextResponse.json({ error: "account, kind (note|task|risk|next_step), title, text required" }, { status: 400 });
  if (title.length > 200 || text.length > 4000) return NextResponse.json({ error: "too long" }, { status: 400 });
  if ((await listNotes()).filter((n) => n.status === "queued").length >= 20) return NextResponse.json({ error: "queue full" }, { status: 429 });
  const refs = Array.isArray(b.refs) ? b.refs.filter((r: unknown) => typeof r === "string").slice(0, 30) : [];
  return NextResponse.json(await addNote({ account, kind, title: title.trim(), text: text.trim(), refs }), { status: 201 });
}
