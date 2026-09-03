# DaTracker — Redesign Brief

## The problem with what exists

The app works. Every core flow is live and in daily use by a real team. This is not a
rescue — it is a level-up. Three things limit it:

1. **One 1,855-line HTML file.** Every change is a surgical edit against a wall of inline
   JS. There is no type checking, so schema drift is caught by users, not by tooling.
2. **Deployment is manual paste.** The repo, the live site, and the working copy drift
   apart. There is no build, no CI, no test.
3. **The promoter UI asks too much.** Users described as "not technical" are struggling —
   which means the interface is at fault, not the people. The sign-in screen in particular
   grew three controls where one would do.

## What success looks like

- A promoter logs a sale in **two taps** from opening the app, and never has to wonder
  which day or outlet they are logging against.
- A sale logged with no signal is **not lost**.
- The supervisor sees "who has not reported today" **without scrolling**.
- A schema change breaks the **build**, not the numbers.
- Deploying is `git push`.

---

## Architecture

**Vite + TypeScript + React + Tailwind** — decided, not open for debate — deployed as a
static build to GitHub Pages via GitHub Actions.

The framework matters less than these two commitments:

1. **Every bug this project has shipped came from untyped data access or duplicated date
   logic.** The core of the redesign is a typed data layer, not a UI rewrite.
2. **Writes are offline-first from the first line of code.** Not a later phase, not a
   wrapper added at the end — the only way a component can write is by going through a
   queue. Retail floors have dead spots; a sale must survive one.

```
src/
  lib/
    supabase.ts        # client, single instance
    businessDay.ts     # THE date authority — 2am cutoff, KSA. Nothing else computes dates
    queue.ts           # offline write queue (IndexedDB)
  data/                # one module per table; every query scoped correctly, always
    attendance.ts      #   listByPromoter, createSession, backfill...
    sales.ts
    outlets.ts
    routePlans.ts
    targets.ts
    users.ts
    tasks.ts
  features/
    auth/
    promoter/          # sign-in, sale entry, stock, checklist, my-days
    supervisor/        # overview, team, plan, admin
    reports/           # the six generators, pure functions, unit-tested
  design/
    tokens.css         # the design system, single source
    components/        # Button, Sheet, Field, Stat, Accordion...
  types/
    database.ts        # GENERATED — never hand-edited
```

Rules that make this hold:

- **No component queries Supabase directly.** UI calls `data/*`, which returns typed
  results. City scoping and business-day handling live there, so they cannot be forgotten.
- **`businessDay.ts` is the only place a date of record is computed.** Anything calling
  `new Date().toISOString()` outside it is a bug.
- **Report generators are pure functions** taking data and returning a string. That makes
  them unit-testable, which matters because they are what the team actually sends.

**Keep:** Supabase, RLS as the security boundary, the public anon key, GitHub Pages, the
Arabic RTL interface, and the existing database — no schema rewrite, only additive
migrations.

---

## Design direction

The current visual identity — deep charcoal with a warm gold — suits the product's retail
register and the team is used to it. **Keep the identity. Systematize it. Spend the
boldness in one place.**

### Palette

Formalize what exists into tokens, then add one thing that is specific to this product:
**the data-visualisation palette is the device colours themselves.** The catalog already
carries six jewel tones — Garnet Red, Electric Purple, Breeze Blue, Aspen Green, Leaf
Green, Digital Violet. Charts that break sales down by device or colour should use the
actual colour of the thing sold. The app's colour language then comes from the products,
not from a generic chart library default.

Semantic colours stay separate and never overlap with the data palette: green for
achieved, gold for close, red for behind, muted for absent.

### Type

IBM Plex Sans Arabic is a genuinely good Arabic face — keep it. Two changes:

- **Tabular figures for every metric.** Counts that shift width as they climb feel unstable.
- **A real type scale.** Currently sizes range from 10px to 27px chosen ad hoc. Define six
  steps and use only those.

### The signature element: the session ribbon

A persistent bar on the promoter's working screen showing **outlet · shift · business date
· LAS against target**, always visible while logging.

This is not decoration — it fixes a real failure. Promoters can open a past day to backfill
sales, and nothing currently keeps that context in view once they scroll. The ribbon makes
"what am I logging against" unmissable, and it shifts tone between day and night shift so
the mode is legible at a glance.

Everything else stays quiet. One bold element, disciplined surroundings.

### Interaction rules for the promoter surface

- **One primary action per screen.** Everything else is secondary or hidden.
- **Minimum 48px touch targets**, thumb-reachable, bottom-anchored.
- **Progressive disclosure.** Backfill, past days, and edge cases live behind a link, not
  in the default view.
- **Optimistic writes.** The UI updates immediately and reconciles; a slow network must
  never look like a failed tap.
- **Errors say what to do**, in Arabic, in the interface's voice — never a Postgres code.

### Supervisor surface

Density is acceptable here, scannability is not optional. Keep the accordion sections, but
lead with a **status strip**: who has not reported today, which outlets are unstaffed,
which targets are missing. The supervisor's first question every morning is "what is
wrong right now" — answer it before showing totals.

---

## Phases

Execute in order. **The legacy app stays live and untouched until parity is proven.**
Build on a branch, deploy to a preview path, switch only when the team has used it.

Design tokens are defined in Phase 1 and used from then on — the design system is never
retrofitted onto finished screens.

### Phase 0 — Baseline
Import the repo, add `CLAUDE.md` and `docs/`, capture current behaviour in
`docs/CURRENT_BEHAVIOUR.md`. Change nothing. Confirm `legacy-datracker.html` matches what
is actually deployed before treating it as reference.

### Phase 1 — Foundation
Vite + TS + React + Tailwind, configured for RTL. Generate `src/types/database.ts` from
Supabase. Build `lib/businessDay.ts` as the sole date authority, unit-tested across the 2am
boundary and month rollover. Build `lib/supabase.ts` and the auth flow, including the
`active = false` block. Define `design/tokens.css`. GitHub Actions deploying to a preview
path.

### Phase 2 — Offline-first data layer ← the core bet
This is the phase that justifies the whole rebuild. Get it right and everything after is
straightforward.

- `lib/queue.ts` — an IndexedDB-backed write queue. Every mutation enqueues, then attempts
  immediately. Success dequeues; network failure retains and retries with backoff.
- **Idempotency is mandatory.** Each queued write carries a client-generated UUID, so a
  replay after a partial success cannot duplicate a sale. Duplicated sales would be worse
  than losing one — they are invisible and they inflate the numbers people are judged on.

  Additive migration:
  ```sql
  alter table sell_operations add column if not exists client_id uuid;
  alter table attendance      add column if not exists client_id uuid;
  create unique index if not exists sell_operations_client_id_idx on sell_operations (client_id);
  create unique index if not exists attendance_client_id_idx      on attendance (client_id);
  -- rollback: drop the two indexes, then the two columns
  -- verify: select count(*) from sell_operations where client_id is not null;
  ```
- `src/data/*` — one module per table. Every query city-scoped and business-day correct at
  this layer. **No React component may call Supabase directly.**
- Reads keep a last-known-good cache so the app opens with data on a cold, offline start.
- The UI always shows a pending count. A queued write is visible, never silent.
- Tests: go offline, queue N sales, reconnect, assert exactly N rows and zero duplicates.
  Then replay the same queue twice and assert the count does not change.

### Phase 3 — Promoter parity
Sign-in, sale entry, session list, stock, checklist, my-days — built on the offline data
layer, so the promoter surface is offline-capable from its first screen. Apply the session
ribbon. Target: **two taps from app open to a logged sale.**

### Phase 4 — Supervisor parity and reports
Port the six report generators as pure functions with snapshot tests first — their output
is what the team sends over WhatsApp, so a regression is visible to everyone at once. Then
overview, team accordion, route plan, targets, outlets, users, tasks.

### Phase 5 — PWA and background sync
Manifest, icons, installability, service worker for the app shell. Background Sync so the
queue replays even when the app is closed — until this ships, replay only happens while the
app is open, which is a real limit worth stating plainly to the owner.

### Phase 6 — Design audit
Status strip on the supervisor overview. Contrast, focus states, reduced motion. Test on a
real phone on a slow connection, not a desktop viewport.

### Phase 7 — New capability
Only after parity is live and stable:

- **Report-sent tracking.** `report_sent_at` on `attendance` — nothing currently records
  who actually submitted their end-of-shift report.
- **Duplicate guard.** Block an identical sale twice within 30 seconds.
- **Undo.** Five seconds to reverse a logged sale.
- **Weekly digest.** Thursday summary ready to forward.
- **Photo attach on stock counts.**
- **Resolve `surveys` / `survey_responses`** — build or drop.

## Non-negotiables

- Zero regressions. A working feature that breaks costs more than a missing feature.
- Arabic RTL throughout the UI; generated reports stay English LTR with no emoji.
- The `service_role` key never enters client code.
- No schema rewrites — additive migrations only, each with a rollback note.
- Every SQL statement handed to the owner comes with a verification query.
- Deployment instructions are literal and exact.
