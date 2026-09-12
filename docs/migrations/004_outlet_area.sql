-- ===========================================================================
-- 004  touch_points.area — grouping outlets by the town they are in
-- ===========================================================================
--
-- WHY THIS IS A NEW COLUMN AND NOT A QUERY
--
-- "Sales by area" needs an area, and the database does not have one. `city` is
-- the only geographic field and every one of the 18 outlets reads `Qassim`, so
-- grouping by it produces a single bar.
--
-- The information does exist in the outlet names — `Tamimi Buraydah`,
-- `Tamimi Al Raas S194`, `SASCO PALM-10851 AZ Zarqa` — but it cannot be parsed
-- out of them safely. It is spelled inconsistently (`Al Raas` in one row,
-- `Al Rass` in another), it is absent from most rows entirely (`Nine Plus
-- Company 2`, `Al-Ghada Super Market`), and a parser guessing at it would
-- produce confident, plausible, wrong groupings — the exact failure this
-- project treats as worse than an obvious crash.
--
-- So the area is recorded rather than inferred. It is nullable, and outlets
-- with no area group under "غير محدد" until someone fills them in; the view
-- works from the first day, and gets better as it is tagged.
--
-- WHY NOT REUSE `city`
--
-- `city` is the RLS and scoping key — the supervisor's whole boundary. Writing
-- town names into it would silently split the team across cities that do not
-- exist, and a supervisor scoped to `Qassim` would stop seeing outlets the
-- moment one was retagged to `Buraydah`.
--
-- ORDER OF DEPLOYMENT
--
--   1. Run this file.
--   2. Regenerate types:  npm run gen:types
--   3. Deploy the client.
--
-- Additive and nullable, so a client that predates it is unaffected and one
-- that follows it simply sees every outlet as untagged.
-- ---------------------------------------------------------------------------

begin;

alter table public.touch_points
  add column if not exists area text;

comment on column public.touch_points.area is
  'Town or district within the city, e.g. Buraydah, Unaizah, Ar Rass. Recorded by hand — it cannot be parsed reliably from the outlet name. Null until tagged; the UI groups those under "غير محدد".';

do $guard$
begin
  if not exists (select 1 from pg_constraint where conname = 'touch_points_area_len') then
    alter table public.touch_points
      add constraint touch_points_area_len
      check (area is null or char_length(btrim(area)) between 1 and 60);
  end if;
end
$guard$;

-- Grouping key for the new view.
create index if not exists touch_points_area_idx
  on public.touch_points (city, area);

commit;


-- ===========================================================================
-- OPTIONAL — a starting point you should check before trusting
-- ===========================================================================
--
-- These are the towns visible in the current outlet names. This is a
-- SUGGESTION, not a migration step: run the SELECT first and correct it before
-- running anything that writes. The spellings below are normalised on purpose
-- ('Al Raas' and 'Al Rass' both become 'Ar Rass'), which is a judgement call
-- that only you can confirm.
--
-- See what it would do:
--
-- select name,
--        case
--          when name ilike '%buraydah%'  or name ilike '%buraidah%' then 'Buraydah'
--          when name ilike '%al raas%'   or name ilike '%al rass%'  then 'Ar Rass'
--          when name ilike '%unaizah%'                              then 'Unaizah'
--          when name ilike '%zarqa%'                                then 'Az Zarqa'
--          else null
--        end as suggested_area
-- from public.touch_points
-- where active
-- order by suggested_area nulls last, name;
--
-- Only if that output looks right, apply it:
--
-- update public.touch_points set area = case
--   when name ilike '%buraydah%' or name ilike '%buraidah%' then 'Buraydah'
--   when name ilike '%al raas%'  or name ilike '%al rass%'  then 'Ar Rass'
--   when name ilike '%unaizah%'                             then 'Unaizah'
--   when name ilike '%zarqa%'                               then 'Az Zarqa'
--   else area
-- end
-- where active;
--
-- Everything else stays null and can be set from the app: Admin → المواقع →
-- edit an outlet → المنطقة.


-- ===========================================================================
-- VERIFICATION
-- ===========================================================================

-- 1. The column exists and is nullable. Expect 1 row, is_nullable = YES.
--
-- select column_name, data_type, is_nullable
-- from information_schema.columns
-- where table_schema = 'public' and table_name = 'touch_points' and column_name = 'area';

-- 2. Nothing was disturbed. Expect the same count as before, and every row
--    still carrying its city.
--
-- select count(*) as outlets, count(city) as with_city, count(area) as with_area
-- from public.touch_points;

-- 3. What the view will show. Untagged outlets appear as one group.
--
-- select coalesce(area, '(untagged)') as area, count(*) as outlets
-- from public.touch_points where active
-- group by 1 order by 2 desc;


-- ===========================================================================
-- ROLLBACK
-- ===========================================================================
--
-- Safe with the client still deployed: the area view falls back to a single
-- untagged group, and nothing else reads the column.
--
-- DESTRUCTIVE only of the tagging itself. Export it first if it took effort:
--   select id, name, area from public.touch_points where area is not null;
--
-- begin;
-- drop index if exists public.touch_points_area_idx;
-- alter table public.touch_points drop constraint if exists touch_points_area_len;
-- alter table public.touch_points drop column if exists area;
-- commit;
