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

**Vite + TypeScript + React + Tailwind**, deployed as a static build to GitHub Pages via
GitHub Actions.

The framework matters less than this: **every bug this project has shipped came from
untyped data access or duplicated date logic.** The core of the redesign is a typed data
layer, not a UI rewrite.

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
Build the new one on a branch, deploy to a preview path, switch only when the team has
used it.

### Phase 0 — Baseline
Import the repo, add `CLAUDE.md` and `docs/`, capture current behaviour. Do not change
behaviour. Confirm `legacy-datracker.html` matches what is deployed before treating it as
reference.

### Phase 1 — Foundation
Vite + TS + React + Tailwind. Generate `database.ts` from Supabase. Build
`lib/businessDay.ts` with unit tests covering the 2am boundary and month rollover. Build
`lib/supabase.ts` and the auth flow. Ship login only. Verify a real account logs in and a
deactivated one is blocked.

### Phase 2 — Data layer + promoter parity
Write `data/*` modules with tests. Rebuild the promoter flow: sign-in, sale entry, session
list, stock, checklist, my-days. Apply the session ribbon. Parity means every action in
`legacy-datracker.html` still works, plus the reduced tap count.

### Phase 3 — Supervisor parity
Overview, team accordion, route plan, targets, outlets, users, tasks. Port the six report
generators as pure functions with snapshot tests — their output is what the team sends, so
regressions here are visible to everyone.

### Phase 4 — Design system
Apply tokens throughout. Add the status strip. Audit contrast, focus states, and reduced
motion. Test on a real phone, not a desktop viewport.

### Phase 5 — PWA + offline
Manifest, icons, installability. Service worker for the app shell. IndexedDB write queue
that replays sales and attendance when the connection returns, with a visible pending
count. **This is the highest-value item on the list** — retail floors have dead spots and
lost sales are currently silent.

### Phase 6 — New capability
Only after parity is live and stable:

- **Report-sent tracking.** Add `report_sent_at` to `attendance`. Today nothing records
  who actually submitted their end-of-shift report.
- **Duplicate guard.** Block an identical sale twice within 30 seconds.
- **Undo.** Five seconds to reverse a logged sale, instead of hunting for the row.
- **Weekly digest.** Thursday summary ready to forward.
- **Photo attach on stock counts.**
- **Resolve `surveys` / `survey_responses`** — build or drop.

---

## Non-negotiables

- Zero regressions. A working feature that breaks costs more than a missing feature.
- Arabic RTL throughout the UI; generated reports stay English LTR with no emoji.
- The `service_role` key never enters client code.
- No schema rewrites — additive migrations only, each with a rollback note.
- Every SQL statement handed to the owner comes with a verification query.
- Deployment instructions are literal and exact.
