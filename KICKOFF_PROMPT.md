# Kickoff prompt for Claude Code

Copy the block below into Claude Code after running `claude` inside the repo.

---

```
Read CLAUDE.md, docs/SCHEMA.md, docs/BUSINESS_RULES.md, and docs/REDESIGN_BRIEF.md before
doing anything. Then read legacy-datracker.html — that is the live production app and the
behavioural reference for everything we rebuild.

Context: DaTracker is a field sales tracker used daily by a 12-person IQOS promoter team in
Al-Qassim, Saudi Arabia. It works today. We are levelling it up, not rescuing it. The owner
is the product owner and does not write code; he has zero tolerance for regressions.

We are executing Phase 0 and Phase 1 from the redesign brief only. Do not start Phase 2.

Phase 0:
- Confirm legacy-datracker.html matches what is deployed at
  https://ahmedfornow.github.io/DaTrack/ before treating it as the reference. Tell me if
  they differ.
- Inventory the current app: every screen, every button, every Supabase query, every
  generated report. Write it to docs/CURRENT_BEHAVIOUR.md. This becomes the parity
  checklist, so be exhaustive and specific rather than summarising.

Phase 1:
- Scaffold Vite + TypeScript + React + Tailwind, configured for RTL.
- Generate src/types/database.ts from the Supabase project (ref lgewtvrqfofnkrfzqqlz). If
  you cannot reach Supabase, stop and tell me what credentials or CLI login you need — do
  not hand-write the types.
- Build src/lib/businessDay.ts as the single authority for dates of record. KSA is UTC+3
  with no DST and the business day ends at 02:00. Unit-test the 2am boundary, month
  rollover, and "yesterday" resolution. Nothing outside this module may compute a date of
  record.
- Build src/lib/supabase.ts and the auth flow: 4-digit login number appended to
  @example.com, password, session restore. A user with active = false must be blocked at
  login with a clear Arabic message.
- Set up GitHub Actions to build and deploy to GitHub Pages on push to main, but deploy to
  a preview path — the legacy app stays live and untouched until we prove parity.

Rules while you work:
- Do not modify legacy-datracker.html. It is the running production app.
- Additive database migrations only. Every migration needs a rollback note and a
  verification query.
- Never put the service_role key in client code.
- Ask before installing any dependency not already named in the brief.
- Commit in small, reviewable steps with clear messages.

Start by reading the docs and giving me your Phase 0 findings plus a Phase 1 plan. Do not
write application code until I approve the plan.
```

---

## Follow-up prompts

One at a time, after the previous phase is approved.

**Phase 2 — offline-first data layer (the core bet)**
```
Phase 1 is approved. Execute Phase 2 from docs/REDESIGN_BRIEF.md.

This is the phase the whole rebuild is for. Writes are offline-first from the first line —
no React component may call Supabase directly, and the only way to write is through the
queue.

Build in this order:
1. lib/queue.ts — IndexedDB-backed. Enqueue, attempt immediately, retry with backoff.
2. Idempotency before anything else. Every queued write carries a client-generated UUID.
   Run the additive client_id migration from the brief, with the rollback note and
   verification query, and give them to me before you run it.
3. src/data/* — one module per table, every query city-scoped and business-day correct.
4. Last-known-good read cache so the app opens with data on a cold offline start.
5. A visible pending count in the UI. A queued write is never silent.

Tests I want to see passing before you call this done:
- Go offline, queue 5 sales, reconnect: exactly 5 rows, zero duplicates.
- Replay the same queue twice: the count does not change.
- Queue a sale at 01:30 KSA: it lands on the previous business day.

Duplicated sales are worse than lost ones — they are invisible and they inflate the numbers
people are judged on. Prove the idempotency works before moving on.
```

**Phase 3 — promoter flow**
```
Execute Phase 3. Rebuild the promoter flow to parity with docs/CURRENT_BEHAVIOUR.md:
sign-in, sale entry, session list, stock, checklist, my-days. It sits on the offline data
layer, so it must work with the network off.

Apply the session ribbon from the brief — outlet, shift, business date, LAS against target,
always visible while logging.

Target: two taps from app open to a logged sale. Show me the tap count for every flow,
before and after.
```

**Phase 4 — supervisor flow and reports**
```
Execute Phase 4. Port the six report generators as pure functions with snapshot tests
FIRST — their output is what the team sends over WhatsApp, so regressions are visible to
everyone. Match current output exactly: English body, LTR, no emoji, sanitised fields,
totals derived from what actually prints.

Then the supervisor surface: overview, team accordion, route plan, targets, outlets, users,
tasks.
```

**Phase 5 — PWA and background sync**
```
Execute Phase 5. Manifest, icons, installability, service worker for the app shell, and
Background Sync so the queue replays even when the app is closed.

Tell me plainly what the offline guarantee is before and after this phase — the owner needs
to know whether a promoter can close the app on a queued sale.
```

## Setup before the first prompt

```bash
git clone https://github.com/ahmedfornow/DaTrack.git
cd DaTrack
```

Copy `CLAUDE.md`, `KICKOFF_PROMPT.md`, `docs/`, and `legacy-datracker.html` into the repo
root, then:

```bash
git add .
git commit -m "Add project context and redesign brief for Claude Code"
git push
```

Install and start Claude Code:

```bash
npm install -g @anthropic-ai/claude-code
claude
```

For the type generation step it will need the Supabase CLI authenticated:

```bash
npm install -g supabase
supabase login
```

**Before you start:** confirm `legacy-datracker.html` is the version actually deployed. If
you have pasted any changes into GitHub since the last file I gave you, replace it with the
current `index.html` from the repo so the reference is real. Claude Code will check this in
Phase 0, but starting from the right file saves a round trip.
