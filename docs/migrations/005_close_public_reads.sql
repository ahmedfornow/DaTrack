-- ===========================================================================
-- 005  close the public reads on route_plans, targets and touch_points
-- ===========================================================================
--
-- WHAT WAS WRONG
--
-- Each of these three tables had a read policy shaped like this:
--
--   create policy "all read route plans" on route_plans
--     for select to public using (true);
--
-- `public` is every Postgres role, and that includes `anon` — the role a
-- request gets before anyone logs in. `using (true)` is every row. And the key
-- that makes an anon request is the publishable key, which is shipped inside
-- the app's JavaScript and readable by anyone who opens the page.
--
-- Checked on 2026-09-17 with only that key, no login:
--
--   route_plans    132 rows — 11 employees, per-date leave status including
--                             sick, absent and annual leave, plus created_by
--   targets         54 rows — every outlet's sales target, by month
--   touch_points    18 rows — outlet names, POS codes, map links
--
-- Names were not exposed — `users` is locked, so the promoter ids are opaque
-- UUIDs — but each person's absence history was. None of this was introduced by
-- the rebuild; these policies predate it and the legacy app used them as-is.
--
-- WHY THIS CANNOT LOCK ANYONE OUT
--
-- Restricting reads to logged-in users is only safe if nothing reads these
-- tables before login. Verified in both apps before writing this:
--
--   rebuild  App.tsx renders only LoginScreen while signed out; PromoterFlow
--            and SupervisorFlow mount only once a profile has loaded, and the
--            auth layer imports no data module at all.
--   legacy   the only pre-login code is line 1852,
--              db.auth.getSession().then(({data:{session:s}}) => { if (s) route() })
--            and every read after it depends on profile.city or profile.id,
--            which exist only once someone is logged in.
--
-- WHAT CHANGES
--
--   targets, touch_points  any logged-in user can read, exactly as before.
--                          Promoters need both: the outlet list at sign-in and
--                          their session's target.
--
--   route_plans            a logged-in user reads their OWN rows, and
--                          supervisors and managers read everything. This is
--                          tighter than before on purpose — the old policy also
--                          let every promoter read every other promoter's sick
--                          and absence days.
--
--   Who actually reads route_plans today:
--     rebuild  the supervisor's plan editor only (data/routePlans.ts, loadPlan)
--     legacy   the supervisor's editor, and a promoter reading their OWN plan
--              for the sign-in prefill (.eq('promoter_id', profile.id))
--   Both are covered.
--
-- One trap avoided. The existing write policy "supervisor writes own city
-- plans" is FOR ALL, so it also grants SELECT — but it scopes by
-- `touch_point_id IN (...)`, and leave rows carry touch_point_id NULL. `NULL IN
-- (...)` is NULL, not true, so that policy alone would hide every leave row
-- from the supervisor. (Lesson 6 in CLAUDE.md, the same bug in a new place.)
-- The read policy below checks the role directly and does not depend on it.
--
-- ORDER OF DEPLOYMENT
--
-- No client change. Run this file; nothing needs regenerating or redeploying.
--
-- The drops and creates share one transaction, so there is no moment where a
-- table has no read policy and logged-in users are refused.
-- ---------------------------------------------------------------------------


-- ===========================================================================
-- PRE-FLIGHT — run this FIRST and read the with_check column
-- ===========================================================================
--
-- Your earlier export showed `qual` but not `with_check`, and INSERT policies
-- only use with_check. "supervisor inserts route plans" showed qual = null,
-- which is normal for an INSERT policy — but if its with_check is also null or
-- `true`, then anyone with the public key can WRITE route plans too, not just
-- read them. This migration does not change write policies; paste the result
-- back before assuming they are fine.
--
-- select tablename, policyname, cmd, roles, with_check
-- from pg_policies
-- where schemaname = 'public'
--   and tablename in ('route_plans', 'targets', 'touch_points')
--   and cmd in ('INSERT', 'ALL', 'UPDATE')
-- order by tablename, cmd;
--
-- Safe looks like: every with_check either references my_role() or is null on
-- an ALL policy (ALL reuses its `qual` as the check when with_check is null).


begin;

-- --- route_plans: own rows, or staff ---------------------------------------

drop policy if exists "all read route plans" on public.route_plans;
drop policy if exists "own or staff read route plans" on public.route_plans;

create policy "own or staff read route plans" on public.route_plans
  for select
  to authenticated
  using (
    promoter_id = auth.uid()
    or public.my_role() in ('supervisor', 'manager')
  );

-- --- targets: any logged-in user -------------------------------------------

drop policy if exists "all read targets" on public.targets;
drop policy if exists "members read targets" on public.targets;

create policy "members read targets" on public.targets
  for select
  to authenticated
  using (true);

-- --- touch_points: any logged-in user --------------------------------------

drop policy if exists "all read touch_points" on public.touch_points;
drop policy if exists "members read touch_points" on public.touch_points;

create policy "members read touch_points" on public.touch_points
  for select
  to authenticated
  using (true);

commit;


-- ===========================================================================
-- VERIFICATION
-- ===========================================================================

-- 1. The three old policies are gone and the three new ones are in place,
--    scoped to {authenticated}. Expect exactly 3 rows, none of them {public}.
--
-- select tablename, policyname, roles, qual
-- from pg_policies
-- where schemaname = 'public'
--   and tablename in ('route_plans', 'targets', 'touch_points')
--   and cmd = 'SELECT'
-- order by tablename;

-- 2. The leak is closed. From outside, with only the public key, every one of
--    these must now return an empty list []. Claude can run this check without
--    any login — ask it to "re-run the public read audit".

-- 3. Nothing broke, in the order most likely to catch a problem:
--
--    a. Sign in as a PROMOTER. The sign-in screen must list outlets — that is
--       touch_points. If the outlet list is empty, roll back immediately.
--    b. Log a sale. The session target must show — that is targets.
--    c. Sign in as the SUPERVISOR, open الخطة. Saved plans must load,
--       INCLUDING leave rows (off / sick / annual / absent). If assignments
--       show but leave rows are missing, the NULL trap above is back.
--    d. Open /legacy/ as a promoter on a day with a saved plan. The prefill
--       toast should still appear — that is the own-rows branch.


-- ===========================================================================
-- ROLLBACK
-- ===========================================================================
--
-- Restores the previous public reads exactly — which also reopens the leak.
-- Only for use if a check in 3 above fails.
--
-- begin;
-- drop policy if exists "own or staff read route plans" on public.route_plans;
-- drop policy if exists "members read targets"        on public.targets;
-- drop policy if exists "members read touch_points"   on public.touch_points;
-- create policy "all read route plans"  on public.route_plans  for select to public using (true);
-- create policy "all read targets"      on public.targets      for select to public using (true);
-- create policy "all read touch_points" on public.touch_points for select to public using (true);
-- commit;
