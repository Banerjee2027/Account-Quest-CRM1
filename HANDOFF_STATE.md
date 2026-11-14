# HANDOFF_STATE.md  (live - update after EVERY phase)

## Status
- **Verification done so far (this session):** end-to-end test vs a MOCK MCP (SSE+JSON, 429 on fast calls) passed: 7 hydration calls in order, note queued->synced, live rotation, analyzer Q1-Q5 correct on mock data. Fixed: team records classified as people, raw-JSON signal titles, month-only departure label, a TS cast error. tsc (without react/next types installed) shows no remaining errors in lib/ or api routes. TSX NOT fully type-checked (needs `npm install`).
- **Added:** `/debug` page (app/debug/page.tsx) with 'Copy report for Claude' button (schema + trimmed raw samples); `tokenSet` boolean in /api/state; red banner on dashboard if AQ_TOKEN missing. User prefers Hinglish, simple explanations.
- **Current phase:** Phase 4 COMPLETE (README.md, THINKING_DOC.md written). Remaining = VERIFICATION ONLY.
- **Next actions (in order):** 1) `npm install && npm run build`, fix any TS errors (code was never compiled). 2) Set AQ_TOKEN + Upstash env, run dev, wait for hydration. 3) Inspect `/api/state?debug=1`; fix `lib/analyzer.ts` aliases (VK, provOf, rolesOf, walk) and `lib/plan.ts` arg variants / write_note account value to match real payloads. 4) Deploy to Vercel, test in incognito. 5) Copy THINKING_DOC.md into Google Docs.

## Completed files (Phase 3)
- `components/types.ts` (StateResp, Draft), `components/ui.tsx` (usd, Level, Badge, Chips, Card, Empty), `components/Cards.tsx` (Q1-Q5), `components/Drawers.tsx` (ReceiptDrawer looks up raw record via /api/state?debug=1; NoteDrawer), `components/Dashboard.tsx` (tabs Overview/A/B, status bar with slot countdown + hydration bar, signals feed, write-back queue), `app/page.tsx`.
- Client polling: /api/state every 5s; /api/live-poll fired when countdown hits 0 (>=4s apart); paused when tab hidden.
- NOT compile-checked (no npm/network in authoring env): run `npm install && npm run build` and fix any TS errors first.

## Completed files (Phase 1)
- `package.json` (next 14.2.15, react 18.3.1, tailwind 3.4.6, server-only), `tsconfig.json` (`@/*` alias), `next.config.mjs`, `postcss.config.mjs`, `tailwind.config.ts`, `.gitignore`, `.env.example`
- `app/layout.tsx`, `app/globals.css`, `app/page.tsx` (placeholder until Phase 3)
- `lib/store.ts`, `lib/mcp.ts`

## Completed files (Phase 2)
- `lib/analyzer.ts` (`analyze()`, `extractAccounts()`, all output types: `Analysis`, `AccountAnalysis`, `DealRow`, `PowerRow`, `Move`, `Risk`, `Gap`, `Receipt`)
- `lib/plan.ts` (`HYDRATION`, `tick()`, `forceFetch()`, `mergeSignals()`, `accountKeyFor()`, `hydrationStatus()`)
- `app/api/state/route.ts` (GET, DB-only, `?debug=1` adds raw cached payloads), `app/api/live-poll/route.ts` (GET/POST -> tick), `app/api/hydrate/route.ts` (GET status, POST tick-hydrate or `{force,tool,args}`), `app/api/notes/route.ts` (GET, POST create or `{retry:id}`)
- Store: Note gained `sendingAt`; extra keys `signals-log`, `hydrate-fails`, `live-rot`.

## ANALYZER CAVEAT (important)
The real MCP payload schema was NOT seen when writing `lib/analyzer.ts`. It uses alias lists (VK value keys, provOf(), rolesOf(), walk() classification by presence of fact_id/deal_id/person_id/file_id/path). FIRST ACTION in Phase 3/4 once real data hydrates: open `/api/state?debug=1`, compare `analysis.schema` + `raw` with the assumptions, and fix aliases. Per-account tool args are also guessed: variants `{account:key}` -> `{account_id:key}` -> `{account:name}` (3 failed tries then skip step). `write_note` uses `account: key` from get_my_accounts; may need the name instead.

## Architectural decisions
1. **Store drivers (auto-detected, `driver()`):** Upstash/Vercel KV REST (`UPSTASH_REDIS_REST_URL/TOKEN` or `KV_REST_API_URL/TOKEN`) -> JSON file `/tmp/aq-store.json` -> memory. No extra deps (fetch REST). User has NOT yet chosen Supabase vs KV; KV/Upstash is the default recommendation. Supabase NOT implemented.
2. **Rate limit:** global lock `claim("mcp-slot", 62000)` in the store (SET NX PX on Upstash). `callTool()` THROWS `RateLimitedError(retryAfterMs)` instead of sleeping (Vercel time limits). 429 keeps the slot held; network TypeError releases it.
3. **Serverless scheduler = "tick" model:** no cron/background process. Each `/api/hydrate`, `/api/live-poll` request calls one `tick()` that (priority: queued notes -> next hydration step -> get_signals/whoami/list_notes rotation) runs ONLY if the slot is free; otherwise returns countdown. Client pings `/api/live-poll` every ~15s (cheap no-op when slot busy) and reads `/api/state` every 5s (DB only, never MCP).
4. **Cache:** `getCached/setCached(tool,args)` keyed `cache:<tool>:<stable-args>`; `callToolCached()` never re-fetches unless `force`.
5. **Notes:** `Note.status` queued -> sending -> synced | failed; `refs[]` holds receipt IDs. Keys: `notes`, `meta`, `cache:*`.
6. **MCP response handling:** handles JSON or SSE bodies; unwraps `result.content[0].text` JSON string (or `structuredContent`).

## Env vars
- `AQ_TOKEN` (required, server-only), optional `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `AQ_STORE_FILE`.

## Store schema
- `cache:<tool>:<args>` -> `{tool,args,data,fetchedAt}`; `meta` -> `{hydrateStep,hydrated,lastCallAt,lastCallTool,lastSignalsAt,lastError,callCount}`; `notes` -> `Note[]`.

## Open items / unknowns for Phase 2
- Exact argument shape of `get_all_paperwork`, `get_feature_requests` etc. is UNKNOWN: derive from `get_data_format` + `get_my_accounts` output during hydration (plan steps 1-2 are static, rest dependent). Do not guess IDs.
- Hydration order (7 calls, 62s apart): get_data_format, get_my_accounts, get_all_paperwork(A), get_all_paperwork(B), get_feature_requests, get_release_notes, get_flytbase_team. Then loop get_signals / whoami / list_notes.

## Deploy target: Render (chosen over Vercel)
- `render.yaml` blueprint added (web service, `npm start`, env: AQ_TOKEN, UPSTASH_REDIS_REST_URL/TOKEN as sync:false).
- Build verified locally: tsc clean, `next build` passes. Free Render disk is ephemeral + sleeps after ~15 min idle -> Upstash REST store still REQUIRED for cache/62s lock.
