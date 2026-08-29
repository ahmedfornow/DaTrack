# DaTracker — Database Schema

Supabase project `lgewtvrqfofnkrfzqqlz` · Postgres 17 · eu-central-1

> **This document is a map, not the territory.** Verify before relying on exact types:
> ```bash
> supabase gen types typescript --project-id lgewtvrqfofnkrfzqqlz > src/types/database.ts
> ```
> All tables live in `public` and **all have RLS enabled**.

---

## Enums

| Enum | Values |
|---|---|
| `shift` | `day`, `night` |
| `sale_type` | `SK`, `MGM`, `SK+MGM`, `LD` |
| `customer_type` | `LAS`, `LAU` |
| `role` | `manager`, `supervisor`, `promoter` |

`route_plans.status` is a plain `text` column with a CHECK constraint, not an enum:
`off`, `sick`, `annual`, `absent`.

---

## Helper function

```sql
create or replace function public.my_role()
returns text language sql stable security definer as $$
  select role from public.users where id = auth.uid();
$$;
```

Returns `NULL` in the SQL Editor (no authenticated user). Test from the browser console.

---

## Tables

### `users`
Profile rows mirroring `auth.users`. **No trigger** — provisioning is manual.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | FK → `auth.users.id` |
| `full_name` | text | Displayed everywhere |
| `role` | role | |
| `city` | text | Scoping key, e.g. `Qassim` |
| `active` | boolean | `false` must block login |
| `login_no` | text | Display only — 4 digits, derived from the auth email |

The real credential is the email (`1699@example.com`). Changing `login_no` does **not**
change what the user types to log in.

### `touch_points`
Outlets.

| Column | Type | Notes |
|---|---|---|
| `id` | bigint PK | |
| `name` | text UNIQUE | Format `QAS_Outlet Name_TYPE_MN_BR`. Display strips to `split('_')[1]` |
| `unicode` | text | POS code, numeric, printed in route messages |
| `maps_url` | text | Must hold only a URL |
| `shift_mode` | text | `day` \| `night` \| `dual` — CHECK constrained |
| `dual_shift` | boolean | **Legacy.** Kept in sync (`shift_mode='dual'`). Migrate off it |
| `is_ds` | boolean | Direct Sales — printed in its own message section |
| `city` | text | |
| `active` | boolean | |

### `attendance`
One row per promoter per day per shift. The anchor for sales and stock.

| Column | Type | Notes |
|---|---|---|
| `id` | bigint PK | |
| `promoter_id` | uuid | FK → `users` |
| `work_date` | date | **Business day** (2am cutoff), not calendar date |
| `touch_point_id` | bigint NULL | Null for leave days |
| `shift` | shift NULL | Null for leave days |
| `status` | text | `work`, `off`, `sick`, `leave`, `absent` |
| `guided_trials` | int | Set when the end-of-shift report is generated |
| `checked_in_at` | timestamptz | |
| `client_op_id` | text NULL | Idempotency tag — see below. Null for every row predating migration 001 |

**UNIQUE (`promoter_id`, `work_date`, `shift`)** — surfaces as error `23505`.

**UNIQUE (`promoter_id`, `client_op_id`) WHERE `client_op_id` IS NOT NULL** —
also a `23505`, and the two are told apart by looking the id up, not by parsing
the constraint name.

### `sell_operations`
One row per device sold. Quantity is always 1.

| Column | Type | Notes |
|---|---|---|
| `id` | bigint PK | |
| `attendance_id` | bigint | FK → `attendance`. Never null |
| `promoter_id` | uuid | Denormalised for query speed |
| `work_date` | date | Denormalised — must match the parent attendance |
| `device_type` | text | Composite FK → `device_catalog` |
| `color` | text | Composite FK → `device_catalog` |
| `sale_type` | sale_type | |
| `customer_type` | customer_type | |
| `created_at` | timestamptz | |
| `client_op_id` | text NULL | Idempotency tag — see below. Null for every row predating migration 001 |

Composite FK `(device_type, color)` → `device_catalog`. **Casing must match exactly** —
`ILUMA i Prime`, not `ILUMA i PRIME`.

**UNIQUE (`promoter_id`, `client_op_id`) WHERE `client_op_id` IS NOT NULL.**

### Idempotent writes

`client_op_id` exists so a retried offline write cannot become a second row. The
client generates one id per logical write — before the first attempt, not when
it fails — and reuses it for every retry, so an attempt that follows a lost
response collides with the row it already wrote.

A `23505` on one of these tables is therefore not automatically a failure. The
client looks the id up: a row carrying it means the earlier attempt committed
and the write is done; no row means a different constraint was violated and the
conflict is real. Added by
[`docs/migrations/001_client_op_id.sql`](migrations/001_client_op_id.sql).

Rows written by the legacy app never carry an id, which is why the index is
partial and the column stays nullable.

### `device_catalog`
17 valid device+colour combinations.

| Line | Colours |
|---|---|
| ILUMA i Prime | Midnight Black, Aspen Green, Electric Purple, Garnet Red, Breeze Blue |
| ILUMA i | Leaf Green, Vivid Terracotta, Digital Violet, Midnight Black, Breeze Blue, Electric Purple |
| ILUMA i One | Leaf Green, Vivid Terracotta, Digital Violet, Midnight Black, Breeze Blue, Electric Purple |

### `targets`
Monthly per outlet per shift.

| Column | Type | Notes |
|---|---|---|
| `touch_point_id` | bigint | |
| `shift` | shift | |
| `month` | text | `YYYY-MM` |
| `daily_target` | numeric | LAS per day |
| `gt_target` | numeric | Guided trials per day |

**UNIQUE (`touch_point_id`, `shift`, `month`)** — the upsert conflict target.

### `route_plans`
Tomorrow's assignments. **One row per promoter per day** — promoter-centric, not
outlet-centric.

| Column | Type | Notes |
|---|---|---|
| `id` | bigint PK | |
| `plan_date` | date | |
| `promoter_id` | uuid | |
| `touch_point_id` | bigint NULL | Null when the row is a leave status |
| `shift` | shift NULL | Null when the row is a leave status |
| `status` | text NULL | `off` \| `sick` \| `annual` \| `absent`. Null when assigned |
| `created_by` | uuid | |

Constraints:
```sql
-- either an assignment or a status, never both, never neither
check ((touch_point_id is not null and shift is not null and status is null)
    or (touch_point_id is null     and shift is null     and status is not null))

-- one assignment per promoter per day
create unique index route_plans_one_per_promoter_day on route_plans (plan_date, promoter_id);
```

Two promoters *may* share an outlet+shift — the UI warns but allows it.

### `stock_catalog` / `stock_reports`
Catalog: `id`, `item_name`, `category` (`device` | `terea`), `sort_order`, `active`.
Reports: `attendance_id`, `promoter_id`, `item_id`, `quantity`, `reported_at`.
**UNIQUE (`attendance_id`, `item_id`)** — the upsert conflict target.

### `checklist_items` / `checklist_responses`
Items: `id`, `title`, `active`, `sort_order`, `created_by`.
Responses: `item_id`, `promoter_id`, `work_date`, `checked`.
**UNIQUE (`item_id`, `promoter_id`, `work_date`)**.

### `sup_tasks`
Supervisor's private reminders. Owner-scoped by RLS.

| Column | Type | Notes |
|---|---|---|
| `id` | bigint PK | |
| `owner_id` | uuid | Only this user can read or write the row |
| `title` | text | |
| `kind` | text | `daily` \| `weekly` \| `once` |
| `weekday` | smallint NULL | 0–6, for `weekly` |
| `due_date` | date NULL | for `once` |
| `done` | boolean | Manual reset — no auto-rollover |

### `surveys` / `survey_responses`
**Empty and unused.** Either build on them or drop them; do not leave them ambiguous.

---

## RLS model

| Role | Access |
|---|---|
| `promoter` | Own rows only. Can insert attendance, sales, stock, checklist responses |
| `supervisor` | Everything in their own `city`. Can delete sales and attendance |
| `manager` | Read-only, all cities |

Policies are **permissive** (OR-ed). A restrictive policy would AND with the others — if
one is ever added, it can veto rows the others allow, which is hard to diagnose.

Optional edit-lock, scoped so current-month backfill still works:
```sql
using (promoter_id = auth.uid()
   and work_date >= date_trunc('month', (now() at time zone 'Asia/Riyadh'))::date)
```

---

## Verification queries

Health check — every integrity row should read `0`:
```sql
select
 (select count(*) from sell_operations where attendance_id is null)                    as orphan_sales,
 (select count(*) from sell_operations s join attendance a on a.id = s.attendance_id
    where s.work_date <> a.work_date or s.promoter_id <> a.promoter_id)                as parent_mismatch,
 (select count(*) from sell_operations
    where customer_type = 'LAU' and sale_type in ('MGM','SK+MGM'))                     as illegal_mgm,
 (select count(*) from attendance where status = 'work' and touch_point_id is null)    as work_without_outlet,
 (select count(*) from touch_points where active and unicode is null)                  as missing_pos_code,
 (select count(*) from (select plan_date, promoter_id from route_plans
    group by 1,2 having count(*) > 1) x)                                               as double_booked;
```

Who was where, by day and outlet:
```sql
select a.work_date,
       coalesce(split_part(tp.name,'_',2), tp.name) as outlet,
       string_agg(u.full_name || ' (' || a.shift || ')', '  |  '
                  order by a.shift, u.full_name) as who_was_there
from attendance a
join users u on u.id = a.promoter_id
join touch_points tp on tp.id = a.touch_point_id
where a.status = 'work' and a.work_date >= date_trunc('month', now())::date
group by a.work_date, tp.name
order by a.work_date desc, outlet;
```

Plan vs actual:
```sql
select coalesce(rp.plan_date, a.work_date) as d,
       u.full_name as promoter,
       case
         when a.id  is null then 'planned, never signed in'
         when rp.id is null then 'worked, never planned'
         when rp.touch_point_id is distinct from a.touch_point_id then 'different outlet'
         when rp.shift is distinct from a.shift then 'different shift'
         else 'match'
       end as result
from route_plans rp
full outer join attendance a
  on a.promoter_id = rp.promoter_id and a.work_date = rp.plan_date
left join users u on u.id = coalesce(rp.promoter_id, a.promoter_id)
where coalesce(rp.plan_date, a.work_date) >= date_trunc('month', now())::date
order by d desc, promoter;
```
