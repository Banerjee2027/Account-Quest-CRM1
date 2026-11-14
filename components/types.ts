import type { Analysis, Move } from "@/lib/analyzer";
import type { Note } from "@/lib/store";

export type StateResp = {
  now: number; tokenSet: boolean; store: "upstash" | "file" | "memory"; waitMs: number;
  meta: { hydrateStep: number; hydrated: boolean; lastCallAt: number | null; lastCallTool: string | null; lastSignalsAt: number | null; lastError: string | null; callCount: number };
  hydration: { step: number; total: number; done: boolean; next: string | null };
  analysis: Analysis; notes: Note[];
  signals: { key: string; seenAt: number; signal: unknown }[];
  cached: { tool: string; args: Record<string, unknown>; fetchedAt: number }[];
};
export type Draft = { account: "A" | "B"; kind: string; title: string; text: string; refs: string[] };
export type { Move };
