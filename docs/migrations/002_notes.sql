-- ===========================================================================
-- 002  notes — a synced place to write things down
-- ===========================================================================
--
-- WHY
--
-- The supervisor already has `sup_tasks` for structured reminders: a title, a
-- kind, a done flag. What there is no room for is unstructured text — what a
-- shop manager said, a phone number, half a thought before a call. Today that
-- lives in the phone's notes app, which nobody else's device can see and which
-- is not there when the supervisor opens DaTracker on a laptop.
--
-- This table is deliberately one text column. A note is a note; splitting it
-- into title and body only forces a decision at the moment someone is trying
-- to write quickly. The list derives its heading from the first line.
--
-- SHAPE
--
-- Owner-scoped, exactly like `sup_tasks`: only the person who wrote a note can
-- read, change or delete it. Nothing here is shared, and no role sees anyone
-- else's notes — not the supervisor, not the manager.
--
-- `owner_id` is a plain uuid rather than a role-specific column, so promoters
-- can be given the same feature later without touching the schema. Only the UI
-- would change.
--
-- `updated_at` is maintained by a trigger rather than sent by the client. The
-- client has no business inventing a timestamp for a row the server owns, and
-- a device with a wrong clock would otherwise reorder the list.
--
-- ORDER OF DEPLOYMENT
--
--   1. Run this file.
--   2. Regenerate types:  npm run gen:types
--   3. Deploy the client.
--
-- Unlike 001, this order IS load-bearing. A client asking for a table that does
-- not exist gets 404/PGRST205 on every read, and there is no graceful fallback
-- to add here — the feature simply cannot work without its table. Nothing else
-- in the app is affected either way: the notes tab fails alone.
-- ---------------------------------------------------------------------------

begin;

-- --- Table -----------------------------------------------------------------

create table if not exists public.notes (
  id         bigint generated always as identity primary key,
  owner_id   uuid        not null references public.users (id) on delete cascade,
  body       text        not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.notes is
  'Free-text notes, private to their owner. One text column by design; the list derives a heading from the first line.';

-- Bounded so a paste cannot become an unbounded row. 5000 characters is about
-- two pages — far more than anything typed on a phone mid-shift.
do $guard$
begin
  if not exists (select 1 from pg_constraint where conname = 'notes_body_len') then
    alter table public.notes
      add constraint notes_body_len
      check (char_length(body) between 1 and 5000);
  end if;
end
$guard$;

-- The only access pattern: one owner's notes, most recently touched first.
create index if not exists notes_owner_updated_idx
  on public.notes (owner_id, updated_at desc);

-- --- updated_at, owned by the server ---------------------------------------

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $fn$
begin
  new.updated_at = now();
  return new;
end;
$fn$;

drop trigger if exists notes_touch_updated_at on public.notes;
create trigger notes_touch_updated_at
  before update on public.notes
  for each row execute function public.touch_updated_at();

-- --- RLS: own rows only ----------------------------------------------------
--
-- Four separate policies rather than one FOR ALL, so a future change to one
-- verb cannot silently widen the others. All permissive, matching the rest of
-- the schema — a restrictive policy here would AND with everything else and be
-- hard to diagnose.

alter table public.notes enable row level security;

drop policy if exists notes_owner_select on public.notes;
create policy notes_owner_select on public.notes
  for select using (owner_id = auth.uid());

drop policy if exists notes_owner_insert on public.notes;
create policy notes_owner_insert on public.notes
  for insert with check (owner_id = auth.uid());

drop policy if exists notes_owner_update on public.notes;
create policy notes_owner_update on public.notes
  for update using (owner_id = auth.uid())
           with check (owner_id = auth.uid());

drop policy if exists notes_owner_delete on public.notes;
create policy notes_owner_delete on public.notes
  for delete using (owner_id = auth.uid());

grant select, insert, update, delete on public.notes to authenticated;

commit;


-- ===========================================================================
-- VERIFICATION — run after the migration, expect the results described
-- ===========================================================================

-- 1. The table exists with five columns. Expect exactly 5 rows.
--
-- select column_name, data_type, is_nullable
-- from information_schema.columns
-- where table_schema = 'public' and table_name = 'notes'
-- order by ordinal_position;

-- 2. RLS is on and there are four policies, all PERMISSIVE. Expect rls = true
--    and 4 rows reading PERMISSIVE.
--
-- select c.relrowsecurity as rls, p.polname, p.polpermissive, p.polcmd
-- from pg_class c left join pg_policy p on p.polrelid = c.oid
-- where c.relname = 'notes';

-- 3. The index and the trigger exist. Expect 1 row each.
--
-- select indexname from pg_indexes
-- where schemaname = 'public' and indexname = 'notes_owner_updated_idx';
--
-- select tgname from pg_trigger
-- where tgrelid = 'public.notes'::regclass and not tgisinternal;

-- 4. Nothing else was touched. Expect the same counts as before this ran.
--
-- select
--   (select count(*) from public.sup_tasks)       as tasks,
--   (select count(*) from public.sell_operations) as sales,
--   (select count(*) from public.notes)           as notes;

-- 5. AFTER using the app — the trigger really maintains updated_at. Write one
--    note, edit it, then expect updated_at > created_at for that row.
--
-- select id, created_at, updated_at, updated_at > created_at as was_touched
-- from public.notes order by updated_at desc limit 5;

-- 6. Isolation holds: this must return 0 rows for any owner but yourself.
--    Run it from the browser console while signed in, not the SQL editor —
--    auth.uid() is NULL there, so the SQL editor sees nothing regardless.
--
--    (await db.from('notes').select('id, owner_id')).data
--
--    Every row returned must carry your own user id.


-- ===========================================================================
-- ROLLBACK
-- ===========================================================================
--
-- Revert the CLIENT FIRST. A deployed client whose notes tab queries a missing
-- table shows an error on that tab every time it opens. The rest of the app is
-- unaffected, but there is no reason to leave it broken.
--
-- DESTRUCTIVE: this drops the notes themselves. There is no other copy.
-- Export first if anything written is worth keeping:
--
--   select owner_id, body, created_at from public.notes order by created_at;
--
-- begin;
-- drop trigger if exists notes_touch_updated_at on public.notes;
-- drop table if exists public.notes;
-- -- touch_updated_at() is left in place: it is generic and harmless, and a
-- -- later table may already be using it. Drop it only if nothing else does:
-- --   select tgname, tgrelid::regclass from pg_trigger
-- --   where tgfoid = 'public.touch_updated_at'::regproc;
-- commit;
