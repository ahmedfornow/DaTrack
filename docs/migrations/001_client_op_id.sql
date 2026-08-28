-- ===========================================================================
-- 001  client_op_id — making queued writes idempotent
-- ===========================================================================
--
-- WHY
--
-- The offline write queue retries any write that produced no response. That is
-- correct for a write that never left the phone, and wrong for exactly one
-- case: the server committed the row and the response was lost on the way back.
-- The client cannot tell those apart, so today it retries and creates a second
-- sale. A duplicate sale is worse than a visible error, because it is a
-- plausible number that nobody will question.
--
-- This adds a client-supplied operation id to the two tables the queue writes.
-- The client sends the same id for every attempt at one logical write, so the
-- second attempt collides with the first instead of duplicating it. The app
-- then looks the row up by that id and treats the write as the success it
-- actually was.
--
-- WHY TEXT AND NOT UUID
--
-- Ids come from crypto.randomUUID() where it exists. A browser without it falls
-- back to a timestamp-and-counter string, which is not a UUID and would be
-- rejected by a uuid column as 22P02 — a permanent failure that would park the
-- sale. Text accepts both.
--
-- WHY SCOPED BY PROMOTER
--
-- The unique index is (promoter_id, client_op_id) rather than client_op_id
-- alone. The fallback ids above are only guaranteed unique within one device's
-- queue, so a global index could in principle let one promoter's id collide
-- with another's. Scoping by promoter makes such a collision a non-event, and
-- it matches how RLS already scopes reads.
--
-- COST
--
-- Two nullable columns and two partial indexes. Existing rows are untouched and
-- read as NULL, which the partial index ignores entirely. Nothing about the
-- running app changes until the client starts sending the id.
--
-- ORDER OF DEPLOYMENT
--
--   1. Run this file.
--   2. Regenerate types:  npm run gen:types
--   3. Deploy the client.
--
-- That is the preferred order, but it is not load-bearing. The client treats
-- the column as present until the server says otherwise: a PGRST204 makes it
-- drop the id and immediately re-send the same write, then stop attaching the
-- id for the rest of the session. So a client deployed ahead of this file keeps
-- logging sales normally — it just does not dedupe yet — and picks the column
-- up on the next reload after this file runs, with no redeploy.
--
-- The cost of getting the order wrong is therefore one wasted round trip per
-- session, not a broken app. It is written down because relying on that
-- fallback silently is how a temporary degradation becomes permanent.
-- ---------------------------------------------------------------------------

begin;

-- --- Columns ---------------------------------------------------------------

alter table public.attendance
  add column if not exists client_op_id text;

alter table public.sell_operations
  add column if not exists client_op_id text;

comment on column public.attendance.client_op_id is
  'Client-supplied id for one logical write, so a retried queued write collides instead of duplicating. Null for anything written before the offline queue.';

comment on column public.sell_operations.client_op_id is
  'Client-supplied id for one logical write, so a retried queued write collides instead of duplicating. Null for anything written before the offline queue.';

-- --- Shape guard -----------------------------------------------------------
--
-- Bounded so a malformed or hostile value cannot become an unbounded index
-- entry. A UUID is 36 characters; the fallback id is shorter.
-- ALTER TABLE ... ADD CONSTRAINT has no IF NOT EXISTS, hence the guard.

do $guard$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'attendance_client_op_id_len'
  ) then
    alter table public.attendance
      add constraint attendance_client_op_id_len
      check (client_op_id is null or char_length(client_op_id) between 8 and 64);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'sell_operations_client_op_id_len'
  ) then
    alter table public.sell_operations
      add constraint sell_operations_client_op_id_len
      check (client_op_id is null or char_length(client_op_id) between 8 and 64);
  end if;
end
$guard$;

-- --- The indexes that actually do the work ---------------------------------
--
-- Partial, so every pre-existing row (client_op_id IS NULL) stays out of the
-- index. A plain unique index would also work, since Postgres treats NULLs as
-- distinct, but this keeps the index to only the rows it is about.

create unique index if not exists attendance_client_op_id_uniq
  on public.attendance (promoter_id, client_op_id)
  where client_op_id is not null;

create unique index if not exists sell_operations_client_op_id_uniq
  on public.sell_operations (promoter_id, client_op_id)
  where client_op_id is not null;

commit;


-- ===========================================================================
-- VERIFICATION — run after the migration, expect the results described
-- ===========================================================================

-- 1. Both columns exist and are nullable. Expect 2 rows, is_nullable = YES.
--
-- select table_name, column_name, data_type, is_nullable
-- from information_schema.columns
-- where table_schema = 'public' and column_name = 'client_op_id'
-- order by table_name;

-- 2. Both unique indexes exist and are partial. Expect 2 rows, each definition
--    ending in WHERE (client_op_id IS NOT NULL).
--
-- select tablename, indexname, indexdef
-- from pg_indexes
-- where schemaname = 'public' and indexname like '%client_op_id_uniq'
-- order by tablename;

-- 3. Nothing existing was disturbed. Every *_rows count should equal what it
--    was before this file ran, and both *_tagged columns read 0 until the new
--    client is deployed.
--
-- select
--   (select count(*) from public.attendance)                                     as attendance_rows,
--   (select count(*) from public.attendance where client_op_id is not null)      as attendance_tagged,
--   (select count(*) from public.sell_operations)                                as sale_rows,
--   (select count(*) from public.sell_operations where client_op_id is not null) as sales_tagged;

-- 4. AFTER the client is live — is it actually tagging writes? `tagged` should
--    climb with every sale logged by the new client. `untagged_recent` counts
--    recent sales with no id, which should only be sales made from the legacy
--    app; if the whole team is on the rebuild and this is non-zero, the client
--    is not sending the id.
--
-- select count(*) filter (where client_op_id is not null)                        as tagged,
--        count(*) filter (where client_op_id is null
--                           and created_at > now() - interval '7 days')          as untagged_recent
-- from public.sell_operations;

-- 5. The safety net itself: zero duplicate ids, which the index guarantees, so
--    a non-zero result here means the index is missing rather than violated.
--
-- select promoter_id, client_op_id, count(*)
-- from public.sell_operations
-- where client_op_id is not null
-- group by 1, 2 having count(*) > 1;

-- 6. Is the index being read, not just present? idx_scan climbs only when a
--    retry actually collides, so 0 is the healthy steady state and a rising
--    number means bad signal in the field, not a bug.
--
-- select indexrelname, idx_scan
-- from pg_stat_user_indexes
-- where indexrelname in ('sell_operations_client_op_id_uniq',
--                        'attendance_client_op_id_uniq');


-- ===========================================================================
-- ROLLBACK
-- ===========================================================================
--
-- Safe to run with the new client still deployed: it will get PGRST204 on its
-- next write, drop the id, and re-send. Sales keep landing; they just stop
-- being deduplicated.
--
-- begin;
-- drop index if exists public.sell_operations_client_op_id_uniq;
-- drop index if exists public.attendance_client_op_id_uniq;
-- alter table public.sell_operations drop constraint if exists sell_operations_client_op_id_len;
-- alter table public.attendance      drop constraint if exists attendance_client_op_id_len;
-- alter table public.sell_operations drop column if exists client_op_id;
-- alter table public.attendance      drop column if exists client_op_id;
-- commit;
--
-- No sales or attendance rows are lost by this — the columns hold only the
-- deduplication tag, never business data. What is lost is the ability to
-- recognise a retry, so the duplicate window reopens.
