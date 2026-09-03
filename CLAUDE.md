# DaTracker — Project Context

Field sales tracking for an IQOS promoter team in Al-Qassim, Saudi Arabia.
Replaces WhatsApp-based manual reporting. ~12 promoters, 1 supervisor, 1 read-only manager.

**Live:** https://ahmedfornow.github.io/DaTrack/ — the rebuild
**Fallback:** https://ahmedfornow.github.io/DaTrack/legacy/ — the previous app, still published
**Repo:** https://github.com/ahmedfornow/DaTrack

---

## Who uses this

| Role | Count | Device | Tech comfort |
|---|---|---|---|
| Promoter | 12 | Personal phone, one-handed, standing in a shop | Low — assume no patience for anything unclear |
| Supervisor | 1 | Phone + occasional laptop | Moderate — this is the product owner |
| Manager | 1 | Phone | Read-only, city switcher |

**The promoter UI is a logging instrument, not a dashboard.** It gets used mid-shift,
often with a customer waiting. Every extra tap is a real cost. The supervisor UI is a
reading surface — density is fine there, but it must stay scannable on a phone.

All user-facing text is **Arabic, RTL**. Technical identifiers, code, and generated
report bodies are **English/LTR**. Never mix directions inside one text container —
see "RTL traps" below.

---

## Stack

**Current:** the rebuild in `app/` — Vite, React, TypeScript, Tailwind, Vitest. Merging to
`main` builds, tests, and deploys it; there is no manual publish step. See
`docs/REDESIGN_BRIEF.md` for the design direction.

**Legacy:** one 1,855-line `index.html` — inline CSS, inline JS, Supabase + Chart.js from
CDN, no build step. Still published at `/legacy/` as the fallback, and still the
behavioural reference (`legacy-datracker.html` is the same file with CRLF endings).
It was deployed by pasting into the GitHub web editor; **do not edit it that way now**
without also updating the repo copy, because the build asserts the two are byte-identical
and will abort the deploy if they drift.

**Deployment layout** — assembled by `.github/workflows/deploy.yml`:

| Path | Serves |
|---|---|
| `/` | the rebuild |
| `/legacy/` | the previous app, byte-identical to the repo's `index.html` |
| `/next/` | the rebuild's former address — redirects to `/` and unregisters the service worker installed there |

**Backend:** Supabase (Postgres 17, eu-central-1), project ref `lgewtvrqfofnkrfzqqlz`.
Auth is email+password where the email is synthetic: login number `1699` →
`1699@example.com`. Promoters type only the 4-digit number; the app appends the domain.

**Security model:** the anon key is public and that is fine — RLS is the only real
boundary. Every table has RLS enabled. A `my_role()` SECURITY DEFINER function returns
the caller's role from `public.users`.

> **Never put the `service_role` key in client code.** It bypasses RLS entirely and this
> app is a public static file. Anything needing it (creating auth users, resetting
> passwords) must stay in the Supabase dashboard or move to an Edge Function.

---

## Reference docs

- `docs/SCHEMA.md` — every table, column, constraint, and RLS policy
- `docs/BUSINESS_RULES.md` — domain rules that must never be violated
- `docs/REDESIGN_BRIEF.md` — the redesign plan and design direction
- `legacy-datracker.html` — the current working app, kept as behavioural reference

**Regenerate types rather than hand-writing them:**
```bash
supabase gen types typescript --project-id lgewtvrqfofnkrfzqqlz > src/types/database.ts
```

---

## Hard-won lessons — read before writing code

Every item below is a bug that actually shipped. They repeat unless deliberately guarded.

### 1. Dates are not UTC and not device-local
KSA is UTC+3, no DST. The **business day ends at 02:00 KSA**, so a sale logged at 01:30
belongs to the *previous* calendar day. Night-shift promoters routinely log after
midnight.

`toISOString()` on a raw `new Date()` is a bug. Every date-of-record must go through the
business-day helper. Mixing `toISOString()` (UTC) with `getDate()` (device-local) in the
same feature produced off-by-one days that only appeared between midnight and 3am.

### 2. Select every column you reference
PostgREST silently returns `undefined` for columns you did not select. A query selected
`sale_type` but the code read `s.customer_type` — every promoter's LAS count read zero
for weeks and nobody noticed, because zero is a plausible number.

Generated types would have caught this. Use them.

### 3. City scoping is not optional
Supervisors are scoped to `profile.city`. Several loaders filtered the *promoter list* by
city but not the *attendance* or *sales* they were divided against, inflating achievement
percentages. Any query feeding a supervisor view must be city-scoped end to end.

### 4. Write before you clear
The route-plan save ran `delete()` then `insert()`. When the insert failed, the day's plan
was already gone. **Upsert first, remove leftovers second** — a failed write must never
destroy existing data.

### 5. Validate before touching the database
Duplicate detection ran after the insert, so the DB constraint rejected the write and the
user got a generic error. Validate in the client first and name the specific conflict.

### 6. RLS policies must match the column shape
`route_plans.touch_point_id` became nullable so leave rows (off/sick/annual/absent) could
exist. A policy checking `touch_point_id IN (SELECT ...)` evaluates to `NULL` for those
rows — not true — so writes were rejected with an opaque RLS error. When a column becomes
nullable, audit every policy that references it.

Debugging RLS: `select my_role()` in the SQL Editor returns `NULL` because there is no
authenticated user there. Test in the browser console instead:
```js
(await db.rpc('my_role')).data
```

### 7. Never interpolate raw values into HTML attributes
`onclick="fn(${JSON.stringify(id)})"` emits `onclick="fn("abc")"` — the attribute
terminates early and every button in that list dies silently. Use proper event listeners.
This is also the XSS surface: outlet names and promoter names come from user input.

### 8. RTL traps
- A `<textarea>` holding an English report needs `direction: ltr; text-align: left`.
  Without it the content renders scrambled and unusable.
- Arabic words at the end of a line inside an otherwise-Latin message make WhatsApp flip
  the punctuation. Generated reports are pure English for this reason.
- Emoji were removed from all **copied** messages. They are fine in the UI.

### 9. Sanitize what goes into the database
A promoter pasted a page-text copy into an outlet's map-URL field. That text then printed
inside the route-plan WhatsApp message for weeks. Outlet fields are single-line by
definition — collapse whitespace, cap length, and extract only a valid URL from URL
fields. Sanitize on input *and* on output.

### 10. Deactivating a user must actually block them
`users.active = false` was checked nowhere at login. Deactivated promoters kept working
and kept recording sales. Enforce it at login and in RLS.

### 11. Do not analyse a stale copy
The owner deploys by pasting into GitHub. The repo, the live site, and any local file can
all differ. Confirm which version you are looking at before diagnosing anything.

The reverse has also happened, and cost more: uploading a local folder through the GitHub
web UI **silently reverted a week of documentation**, deleting `docs/CURRENT_BEHAVIOUR.md`
and the whole of `docs/migrations/` — including the record of a migration already applied
to production. Nothing failed and no test caught it, because none of it is code.

Before uploading a folder through the web UI, pull first. After any web-UI commit, check
`git log` for `Add files via upload` and diff it. Everything is recoverable from git, but
only if someone notices.

---

## Working style

The owner is the product owner and decision-maker; he does not write code. He is terse and
precise, iterates fast, and has **zero tolerance for regressions** — a working feature that
breaks costs far more trust than a missing feature.

- Prefer surgical edits over rewrites.
- When changing an existing file, state what changed before showing it.
- Any SQL or numeric claim needs a verification query he can run himself.
- Deployment steps must be literal and exact — assume they are followed verbatim.
- Ambiguity: make the best assumption, state it in one line, keep moving. Only stop to ask
  if the action is destructive.
