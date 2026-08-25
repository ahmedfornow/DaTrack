# DaTracker — Business Rules

Domain logic. Breaking any of these produces numbers the team will act on and that are
wrong — worse than an obvious crash.

---

## Sales

**Only LAS customers can receive MGM.**
`customer_type = 'LAU'` with `sale_type` of `MGM` or `SK+MGM` is invalid. Enforce in the
UI (block the tap, explain why) *and* in the database — a UI-only rule is one bypass away
from bad data.

```sql
alter table sell_operations add constraint sell_ops_las_only_mgm
  check (not (customer_type = 'LAU' and sale_type in ('MGM','SK+MGM')));
```

If the user picks LAU while MGM is already selected, clear the sale type rather than
silently keeping an invalid pair.

**LD is standalone.** It is one value of `sale_type`, mutually exclusive with `SK` and
`MGM` by construction. There is no `LD+SK`.

**Only LAS counts toward target.** Every achievement figure, progress bar, and curve
counts LAS only. LAU is tracked and displayed but never scored. Getting this wrong
inflates performance across the whole team.

**Quantity is always 1.** Three devices sold means three rows. This is deliberate — it
keeps device+colour breakdowns exact.

**Device and colour must match `device_catalog` casing exactly.** `ILUMA i Prime`, not
`ILUMA i PRIME`. A composite foreign key enforces it; mismatched casing fails the insert.

---

## The business day

**The day ends at 02:00 KSA (UTC+3, no DST).**

A sale logged at 01:30 belongs to the *previous* business day. Night shifts routinely run
past midnight, and a promoter finishing at 1am is still working "yesterday".

Single source of truth:
```ts
const DAY_CUTOFF_HOUR = 2;
const businessNow = () => new Date(Date.now() + (3 - DAY_CUTOFF_HOUR) * 3600_000);
const businessToday = () => businessNow().toISOString().slice(0, 10);
```

Every date of record — attendance, sales, checklist, stock, "today" on the dashboard,
month boundaries, the default route-plan date — derives from this. Never
`new Date().toISOString()`, never `new Date().getDate()`.

Display of *clock times* (e.g. "logged at 21:45") uses real KSA time, not the shifted
business clock. Only dates-of-record shift.

---

## Attendance

One row per promoter per day per shift. A dual-shift outlet can legitimately produce two
rows for one promoter on one date.

Statuses: `work`, `off`, `sick`, `leave`, `absent`. Only `work` carries an outlet and
shift; only `work` days require a touch point.

**Backfill is allowed within the current month.** Promoters forget to sign in and fix it
later. Do not lock the current month. Prior months may be locked via RLS.

Attendance cannot be deleted while sales reference it — the FK blocks it, and the error
must be explained in plain Arabic ("delete the sales first"), not surfaced as a raw code.

---

## Outlets

`shift_mode` is one of `day`, `night`, `dual`. This drives:

- which shift buttons appear at sign-in
- which target fields appear in the editor
- which rows appear in the route plan
- which lines appear in the generated route message

A night-only outlet must never ask for a day target or offer a day shift.

`dual_shift` (boolean) is legacy. Keep it synchronised while it exists; remove it once
nothing reads it.

Outlet text fields are **single-line by definition**. Collapse whitespace, cap length,
and accept only a valid `https://` URL in the map field. Page text has been pasted into
these fields before and printed inside team-wide WhatsApp messages.

---

## Targets

Set per outlet, per shift, per month. A promoter's target for a day is the target of the
outlet+shift they worked — so their monthly target is the sum across the days they
actually worked, not a fixed number.

Achievement = LAS sales ÷ accumulated target, where the target accumulates only on `work`
days.

Colour thresholds used throughout: **≥100% green, ≥70% gold, below red.** Keep consistent.

---

## Route plans

One row per promoter per day. A promoter is either assigned to an outlet+shift **or**
marked with a leave status — never both, never neither.

Leave statuses: `off`, `sick`, `annual`, `absent`.

Two promoters may share an outlet+shift. Warn, but allow — it happens during training and
handovers.

Saving must **upsert first, then remove** promoters set back to "none". Never delete the
day's plan before the write succeeds.

The plan pre-fills the promoter's sign-in screen. If the plan says leave, the sign-in
screen should preselect that status.

---

## Roles and scoping

| Role | Scope |
|---|---|
| Promoter | Own rows only |
| Supervisor | Their `city` — every query, end to end |
| Manager | Read-only, switches city |

A supervisor query that filters the promoter list by city but not the data those promoters
generated will produce inflated figures. Scope both sides.

`active = false` blocks login. Deactivation preserves history — never hard-delete a person.

---

## Generated reports

Six reports exist. All are copy-to-clipboard plain text except the CSV, which downloads.

| # | Report | Role | Content |
|---|---|---|---|
| 1 | End-of-shift | Promoter | Outlet, date, shift, itemised sales, totals, guided trials |
| 2 | Stock count | Promoter | Per-item quantities grouped by device line |
| 3 | Period summary | Supervisor | LAS, activity, SK/MGM/LD, GT, check-ins, by promoter, by outlet |
| 4 | Month CSV | Supervisor | Every sale with promoter, outlet, shift, device, colour, type |
| 5 | Route plan | Supervisor | Per outlet: POS code, name, URL, shift assignments; then totals and leave list |
| 6 | Team logins | Supervisor | Name + login number. **Never passwords** |

Rules for all copied output:

- **No emoji.** They render inconsistently and add noise to a forwarded message.
- **Pure English body, LTR.** Arabic at a line end flips punctuation in WhatsApp.
- Sanitise every field pulled from the database before printing it.
- Totals must be derived from what actually prints, so the number always matches the list.

The end-of-shift report shows a confirmation dialog first, with a warning when zero sales
were logged or achievement is under 70% — a nudge to check before broadcasting.

---

## Passwords

Passwords are bcrypt hashes in `auth.users`. They **cannot be displayed** — not by the
app, not by the owner, not by a query. Any feature request to "show passwords" is
impossible by design, and the answer is a reset flow instead.

Creating users and resetting passwords requires the `service_role` key, which must never
reach client code. Today that happens in the Supabase dashboard. The supervisor's
"add promoter" flow works around it by claiming a **pre-created spare account**: inactive
placeholder rows that the supervisor renames and activates.

If in-app user creation is ever needed, it goes in a Supabase Edge Function holding the
key server-side — never in the bundle.
