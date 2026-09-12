-- ===========================================================================
-- 003  discipline records, and a to-do list the manager can share
-- ===========================================================================
--
-- Two changes. The second one is a privacy change to existing rows, so read
-- that part before running this.
--
--
-- PART A — `discipline`
--
-- A written record of a warning or a pay deduction against a promoter. Today
-- this happens verbally and lives in someone's memory, which means two people
-- can disagree about whether it happened at all.
--
-- Visible to the supervisor and the manager. NOT to promoters: this table is
-- deliberately unreadable by the person it is about, so nobody learns their pay
-- was cut from a phone screen before anyone has spoken to them. That is a
-- decision about how the team is managed, not a technical one, and it is why
-- there is no promoter policy below rather than a forgotten one.
--
-- `work_date` is the day the thing happened, not the day it was typed. Those
-- differ whenever something is recorded the morning after a night shift, and
-- payroll cares about the former.
--
--
-- PART B — `sup_tasks` becomes shared
--
-- The reminders list has been private to whoever wrote it. It becomes readable
-- and writable by any supervisor or manager, so the two can pass items to each
-- other instead of using WhatsApp.
--
-- ** THIS EXPOSES EXISTING ROWS. ** Every reminder already written by the
-- supervisor becomes visible to the manager the moment this runs. There is no
-- way to widen a shared list without that being true. If any existing row
-- should stay private, delete it before running this file:
--
--   select id, title from public.sup_tasks order by id;
--
-- `owner_id` is kept and still records who created a row, so the list can show
-- who asked for what. It simply no longer restricts who may read it.
--
--
-- ORDER OF DEPLOYMENT
--
--   1. Run this file.
--   2. Regenerate types:  npm run gen:types
--   3. Deploy the client.
--
-- Load-bearing, same as 002: a client querying `discipline` before the table
-- exists gets PGRST205 on that panel. The rest of the app is unaffected.
-- ---------------------------------------------------------------------------

begin;

-- ===========================================================================
-- PART A — discipline
-- ===========================================================================

create table if not exists public.discipline (
  id          bigint generated always as identity primary key,
  promoter_id uuid        not null references public.users (id) on delete cascade,
  work_date   date        not null,
  kind        text        not null,
  amount      text,
  reason      text        not null,
  note        text,
  created_by  uuid        not null references public.users (id),
  created_at  timestamptz not null default now()
);

comment on table public.discipline is
  'Warnings and pay deductions against a promoter. Readable by supervisor and manager only — never by the promoter it concerns.';

do $guard$
begin
  -- Closed value sets. The database has no enums anywhere else either, so these
  -- are CHECKs for consistency with the rest of the schema.
  if not exists (select 1 from pg_constraint where conname = 'discipline_kind_valid') then
    alter table public.discipline add constraint discipline_kind_valid
      check (kind in ('warning', 'deduction'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'discipline_reason_valid') then
    alter table public.discipline add constraint discipline_reason_valid
      check (reason in ('no_show', 'late', 'other'));
  end if;

  -- An amount is exactly what separates a deduction from a warning. A warning
  -- carrying an amount, or a deduction without one, is a row nobody can act on.
  if not exists (select 1 from pg_constraint where conname = 'discipline_amount_matches_kind') then
    alter table public.discipline add constraint discipline_amount_matches_kind
      check (
        (kind = 'deduction' and amount in ('half_day', 'full_day'))
        or (kind = 'warning' and amount is null)
      );
  end if;

  -- 'other' with no explanation is the same as no reason at all.
  if not exists (select 1 from pg_constraint where conname = 'discipline_other_needs_note') then
    alter table public.discipline add constraint discipline_other_needs_note
      check (reason <> 'other' or (note is not null and char_length(btrim(note)) > 0));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'discipline_note_len') then
    alter table public.discipline add constraint discipline_note_len
      check (note is null or char_length(note) <= 500);
  end if;
end
$guard$;

-- Read patterns: newest first overall, and everything against one promoter.
create index if not exists discipline_recent_idx
  on public.discipline (work_date desc, id desc);

create index if not exists discipline_promoter_idx
  on public.discipline (promoter_id, work_date desc);

alter table public.discipline enable row level security;

-- Separate policies per verb, so widening one later cannot silently widen the
-- rest. `my_role()` is SECURITY DEFINER and already used across the schema.
drop policy if exists discipline_staff_select on public.discipline;
create policy discipline_staff_select on public.discipline
  for select using (public.my_role() in ('supervisor', 'manager'));

drop policy if exists discipline_staff_insert on public.discipline;
create policy discipline_staff_insert on public.discipline
  for insert with check (
    public.my_role() in ('supervisor', 'manager') and created_by = auth.uid()
  );

drop policy if exists discipline_staff_update on public.discipline;
create policy discipline_staff_update on public.discipline
  for update using (public.my_role() in ('supervisor', 'manager'))
           with check (public.my_role() in ('supervisor', 'manager'));

drop policy if exists discipline_staff_delete on public.discipline;
create policy discipline_staff_delete on public.discipline
  for delete using (public.my_role() in ('supervisor', 'manager'));

grant select, insert, update, delete on public.discipline to authenticated;


-- ===========================================================================
-- PART B — sup_tasks becomes shared between supervisor and manager
-- ===========================================================================
--
-- The old policies were owner-scoped. Dropping them by name is not safe here
-- because their names were never recorded in this repo, so every existing
-- policy on the table is removed by iterating pg_policy, then the shared set is
-- created. Re-running this file is therefore still safe.

do $policies$
declare
  existing record;
begin
  for existing in
    select polname from pg_policy where polrelid = 'public.sup_tasks'::regclass
  loop
    execute format('drop policy if exists %I on public.sup_tasks', existing.polname);
  end loop;
end
$policies$;

alter table public.sup_tasks enable row level security;

drop policy if exists sup_tasks_staff_select on public.sup_tasks;
create policy sup_tasks_staff_select on public.sup_tasks
  for select using (public.my_role() in ('supervisor', 'manager'));

drop policy if exists sup_tasks_staff_insert on public.sup_tasks;
create policy sup_tasks_staff_insert on public.sup_tasks
  for insert with check (
    public.my_role() in ('supervisor', 'manager') and owner_id = auth.uid()
  );

drop policy if exists sup_tasks_staff_update on public.sup_tasks;
create policy sup_tasks_staff_update on public.sup_tasks
  for update using (public.my_role() in ('supervisor', 'manager'))
           with check (public.my_role() in ('supervisor', 'manager'));

drop policy if exists sup_tasks_staff_delete on public.sup_tasks;
create policy sup_tasks_staff_delete on public.sup_tasks
  for delete using (public.my_role() in ('supervisor', 'manager'));

grant select, insert, update, delete on public.sup_tasks to authenticated;

commit;


-- ===========================================================================
-- VERIFICATION — run after the migration, expect the results described
-- ===========================================================================

-- 1. The discipline table exists with nine columns. Expect 9 rows.
--
-- select column_name, data_type, is_nullable
-- from information_schema.columns
-- where table_schema = 'public' and table_name = 'discipline'
-- order by ordinal_position;

-- 2. Both tables carry exactly four policies each, all PERMISSIVE.
--    Expect 8 rows, rls = true throughout.
--
-- select c.relname, c.relrowsecurity as rls, p.polname, p.polcmd, p.polpermissive
-- from pg_class c join pg_policy p on p.polrelid = c.oid
-- where c.relname in ('discipline', 'sup_tasks')
-- order by c.relname, p.polname;

-- 3. No owner-scoped policy survived on sup_tasks. Expect 0 rows.
--
-- select polname, pg_get_expr(polqual, polrelid) as using_clause
-- from pg_policy
-- where polrelid = 'public.sup_tasks'::regclass
--   and pg_get_expr(polqual, polrelid) like '%auth.uid()%'
--   and polcmd <> 'a';

-- 4. The CHECK constraints actually bite. Each of these must FAIL. Run them
--    one at a time; every one should raise a constraint violation, and none
--    should insert a row.
--
-- insert into public.discipline (promoter_id, work_date, kind, amount, reason, created_by)
--   select id, current_date, 'warning', 'half_day', 'late', id from public.users limit 1;
--   -- expect: discipline_amount_matches_kind
--
-- insert into public.discipline (promoter_id, work_date, kind, reason, created_by)
--   select id, current_date, 'deduction', 'late', id from public.users limit 1;
--   -- expect: discipline_amount_matches_kind
--
-- insert into public.discipline (promoter_id, work_date, kind, amount, reason, created_by)
--   select id, current_date, 'deduction', 'full_day', 'other', id from public.users limit 1;
--   -- expect: discipline_other_needs_note
--
-- Then confirm nothing landed:
--   select count(*) from public.discipline;   -- expect 0

-- 5. AFTER deploying — a promoter cannot read the table. Sign in as a promoter
--    in the browser and run:
--
--      (await db.from('discipline').select('id')).data
--
--    Expect [] (RLS returning nothing), never a row. Run the same as the
--    supervisor and expect the rows you created.

-- 6. AFTER deploying — the shared list really is shared. Add a task as the
--    manager, then confirm the supervisor sees it:
--
--      (await db.from('sup_tasks').select('id, title, owner_id')).data


-- ===========================================================================
-- ROLLBACK
-- ===========================================================================
--
-- Revert the CLIENT FIRST, then run this.
--
-- DESTRUCTIVE for part A: it drops every discipline record. Export first if
-- any are worth keeping:
--
--   select * from public.discipline order by work_date, id;
--
-- Part B restores owner-scoping on sup_tasks. Rows created by the manager stay
-- in the table but become invisible to the supervisor, and vice versa — they
-- are not deleted, just hidden again.
--
-- begin;
-- drop table if exists public.discipline;
--
-- do $rb$
-- declare existing record;
-- begin
--   for existing in select polname from pg_policy where polrelid = 'public.sup_tasks'::regclass
--   loop execute format('drop policy if exists %I on public.sup_tasks', existing.polname); end loop;
-- end
-- $rb$;
--
-- create policy sup_tasks_owner_select on public.sup_tasks
--   for select using (owner_id = auth.uid());
-- create policy sup_tasks_owner_insert on public.sup_tasks
--   for insert with check (owner_id = auth.uid());
-- create policy sup_tasks_owner_update on public.sup_tasks
--   for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
-- create policy sup_tasks_owner_delete on public.sup_tasks
--   for delete using (owner_id = auth.uid());
-- commit;
