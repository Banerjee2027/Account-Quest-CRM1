# Account Quest CRM: Thinking Doc

## What it does and for whom
A one-page CRM view for an account lead who has minutes before a customer call. For each of two accounts it answers five questions: what the book is worth, who holds the power, what to do first, what is about to go wrong, and what we still do not know. Every figure links to a receipt (person, deal, fact, file, paperwork path or signal) that opens in a side drawer with the raw record.

## How it decides
- **Book:** a deal counts as Backed only if a file or a verified fact on record supports its value. Told or claimed values are shown separately as Unbacked and never added to the Backed total.
- **Power:** people are mapped to Decider, Payer, User/Champion and Blocker from role text and stance. A missing Decider or Payer, or a single contact, is flagged.
- **First moves:** candidates come from risks and missing power roles, scored by deal value plus urgency (days to deadline, red/amber). Top 3 shown with owner, deadline, deal and evidence. Unknown owners show as UNASSIGNED instead of a guess.
- **Risks:** text in facts, notes, paperwork and live signals is scanned for deadlines, departures, usage drops and gone-cold contacts. Red is 14 days or less, amber 30 days or less.
- **Blind spots:** unbacked deals, missing roles, usage drops nobody investigated, departures with no named successor, and the fact that other deals may exist off the sheet. Each names who can fill it.
- **Rate limit:** the MCP allows one call a minute. A shared lock enforces 62 s between calls; static data is fetched once and cached, then the budget goes to polling signals. Notes are saved instantly as queued and sent in the next free slot.

## What it does not do yet
- The analyzer was written before seeing real payloads; field aliases may need tuning (a debug view shows the schema).
- Rules are keyword and date based, so unusual phrasing can be missed. There is no semantic understanding.
- No authentication on write routes (by design for judges); the note queue is capped.
- No Supabase option, no history of past analyses, no email or calendar integration.
- Dates without a year assume the nearest upcoming one.

## How AI was used
Claude generated the code in phases with a handoff file so work could continue across chats. The app itself uses no AI at run time: the five answers come from deterministic rules so every claim can be traced to source data.
