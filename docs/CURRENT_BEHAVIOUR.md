# DaTracker — Current Behaviour (Phase 0 baseline)

Captured from `index.html` / `legacy-datracker.html`, MD5 `03b3ff78212f75cbdffcded1993607d6`,
verified byte-identical to `https://ahmedfornow.github.io/DaTrack/` and to
`raw.githubusercontent.com/ahmedfornow/DaTrack/main/index.html` on 2026-08-25.

**This file is the parity checklist.** Every row must still work after the rebuild.
Line references point into the 1,855-line legacy file.

---

## 0. Global

| Item | Value |
|---|---|
| Document | `lang="ar" dir="rtl"` |
| Viewport | `maximum-scale=1.0, user-scalable=no` — pinch zoom disabled |
| CDN deps | `@supabase/supabase-js@2`, `chart.js@4`, IBM Plex Sans Arabic via `@import` |
| Supabase URL | `https://lgewtvrqfofnkrfzqqlz.supabase.co` |
| Public key | `sb_publishable_lrw3zxHRNhgOYqwivMhrjQ_QV5z-NmN` (new-style publishable key, not the legacy anon JWT) |
| Fail-closed guard | If `supabase` is undefined the whole body is replaced with an Arabic "check your internet" message (L462-465). **No equivalent guard for Chart.js** |
| Screens | `loginCard`, `signinCard`, `workScreen`, `staffCard` — exactly one visible, via `show(id)` (L507) |
| Max width | 440px, centred |

### Date authority (L481-489)

```js
const DAY_CUTOFF_HOUR = 2;
ksaNow()  = new Date(Date.now() + 3*3600*1000)                        // real KSA clock
bizNow()  = new Date(Date.now() + (3 - DAY_CUTOFF_HOUR)*3600*1000)    // business clock
todayStr()      = bizNow().toISOString().slice(0,10)
curMonth()      = bizNow().toISOString().slice(0,7)
ksaDayOfMonth() = bizNow().getUTCDate()
curMonthName()  = MONTH_AR[bizNow().getUTCMonth()] + ' ' + getUTCFullYear()
shiftDate(n)    = bizNow() minus n days, ISO date
```

Every date of record already routes through these. **`ksaNow()` is defined and never
called** — dead code, but it is the correct helper for displaying clock times, which the
app currently never does.

### Constants

| Constant | Value |
|---|---|
| `DEVICES` | `ILUMA i Prime` (5 colours), `ILUMA i` (6), `ILUMA i One` (6) — 17 combos, casing matches `device_catalog` |
| `DEV_SHORT` | `ILUMA i Prime` to `PRIME`, `ILUMA i` to `ILUMA i`, `ILUMA i One` to `ONE` |
| `TYPES` | `SK`, `MGM`, `SK+MGM`, `LD` |
| `CUSTS` | `LAS`, `LAU` |
| `STATUSES` (attendance) | `work` دوام, `off` أوف, `sick` مرضية, `leave` استئذان, `absent` غياب |
| `PLAN_STATUS*` (route plan) | `off`, `sick`, `annual`, `absent` — Arabic, Arabic+emoji, and English variants |
| `SHIFT_AR` | `day` نهاري, `night` ليلي |
| `ROLE_AR` | promoter مندوب, supervisor مشرف, manager مدير |
| `TASK_KIND` | daily يومي, weekly أسبوعي, once مرة واحدة |

### Sanitisers (L495-496)

- `oneLine(s, max=80)` — collapses all whitespace, trims, truncates.
- `firstUrl(s)` — regex-extracts the first `https?://…` token, else empty string.

Applied **only** in: outlet add/edit (`addTp`, `saveTpEdit`) and the route-plan message
(`genRouteMsg`). **Not** applied in the end-of-shift report, the stock message, the roster
message, the period summary, or any list rendering.

### Shift-mode helpers (L492-493)

`tpMode(tp)` = `tp.shift_mode` else (`tp.dual_shift` ? `dual` : `day`).
`tpShifts(tp)` = `['day','night']` for dual, else `[mode]`.

---

## 1. Login (`loginCard`)

**Fields:** 4-digit user number (`tel`, maxlength 4), password (`password`, maxlength 10).
**Enter key:** number field focuses password; password field submits (L1846-1847).

**`doLogin()` (L512-520)**
1. Client validation: number length must be exactly 4, password length at least 6. Failure gives
   `أدخل رقم المستخدم وكلمة المرور كاملة`.
2. `db.auth.signInWithPassword({ email: '<4digits>@example.com', password })`.
3. Any error gives `بيانات الدخول غير صحيحة` (generic, no code leaked).
4. Success calls `route()`.

**`route()` (L521-530)**
1. `db.auth.getUser()` — no user means login screen.
2. `db.from('users').select('*').eq('id', user.id).single()`.
3. No profile row: `حسابك غير مسجل — كلّم المشرف`, sign out, back to login.
4. `prof.active === false`: `حسابك موقوف — كلّم المشرف`, sign out, back to login.
5. `role === 'promoter'` goes to `promoterFlow()`, otherwise `staffFlow()`.

**Session restore (L1848):** `db.auth.getSession()` on load; if a session exists, `route()`
runs automatically — the login screen is skipped.

**`doLogout()` (L531):** `signOut()`, clears `profile` / `session` / `todaySession`, clears
both inputs, shows login.

---

## 2. Promoter — day sign-in (`signinCard`)

**`promoterFlow()` (L534-551)**
1. Query today's attendance:
   `attendance.select('*, touch_points(name,dual_shift,shift_mode)').eq(promoter_id).eq(work_date, todayStr()).order(checked_in_at desc).limit(1)`.
   If a row exists, set `todaySession` + `session` and jump straight to `openWork()`. **The
   sign-in screen is never shown twice in one day.**
2. Otherwise render the sign-in card: name, status grid, outlet `select` from
   `touch_points.select('*').eq(active,true).eq(city, profile.city).order(name)`.
3. Date picker bounds: `min = curMonth()+'-01'`, `max = todayStr()`. **Backfill is limited
   to the current month.**
4. `setSigninDate(todayStr())`.

**Controls**

| Control | Behaviour |
|---|---|
| `تسجيل يوم سابق؟` link | `toggleDayPicker()` — reveals the date block, label flips to `إخفاء` |
| `اليوم` / `أمس` chips | `quickDay(0)` / `quickDay(1)` |
| date input | `setSigninDate(value)`, clamped to min/max |
| Status grid (3 cols, 5 options) | `pickStatus(s)`; non-`work` hides the outlet+shift block entirely |
| Outlet select | `onchange = updateShiftUI` |
| Shift row | `pickShift('day'|'night')` |
| `تسجيل اليوم` | `doSignin()` |
| `تسجيل خروج` | `doLogout()` |

**`setSigninDate(dt)` (L554-591)** — this is where most of the intelligence lives:
1. Clamp to min/max, set `signinDate`, sync the input and the today/yesterday chips.
2. Query existing attendance for that promoter+date into `daySessions` and `window.takenShifts`.
3. If rows exist, hint reads `مسجل مسبقاً: <labels>` plus an `افتح الجلسة` link calling
   `openDaySession()`. Otherwise `يوم اليوم — لم يسجل بعد` or `يوم سابق — سيسجل بأثر رجعي`.
4. `updateShiftUI()`.
5. Pre-fill from `route_plans.select('touch_point_id,shift,status').eq(plan_date,dt).eq(promoter_id).limit(1)`:
   - assignment: select the outlet, run `updateShiftUI()`, `pickShift('night')` if night,
     toast `خطتك جاهزة من المشرف`.
   - leave status: `pickStatus(status)` when the plan status also exists as an attendance
     status, toast `المشرف مسجّلك اليوم: <arabic>`. **`annual` has no attendance
     equivalent, so the status grid is left untouched for annual leave.**

**`updateShiftUI()` (L607-618)**
- Shift picker is shown only when the outlet runs both shifts.
- Individual day/night buttons are hidden per `tpShifts`.
- Auto-selects the first shift that the outlet runs **and** that is not already registered
  for the chosen date; falls back to the outlet's first shift.

**`doSignin()` (L620-635)**
- `work`: insert `{promoter_id, work_date, touch_point_id, shift, status:'work'}`.
- Any other status: insert `{promoter_id, work_date, status}` (no outlet, no shift).
- Error `23505`: re-runs `setSigninDate` and shows
  `هذا اليوم مسجل مسبقاً لنفس الفترة — افتح الجلسة من الأعلى`.
- Any other error: `خطأ في التسجيل — حاول مجدداً`.
- Success: `todaySession = session = data`, then `openWork()`.

---

## 3. Promoter — work screen (`workScreen`)

**Top bar:** name, then outlet short name (`name.split('_')[1]`) and `دوام نهاري` /
`دوام ليلي`. For non-work sessions the outlet slot shows the Arabic status and the shift
slot shows the raw `work_date`. Exit button calls `doLogout()`.

**Banners**
- `pastBanner` (gold) when `session.work_date !== todayStr()`:
  `تسجّل الآن على يوم <date>` plus `العودة لليوم الحالي` calling `returnToday()`.
- `offBanner` (green) when `status !== 'work'`: `يومك مسجل — لا مهام مطلوبة اليوم`.

**Tab visibility (`openWork`, L637-655)**

| Tab | Shown when |
|---|---|
| المبيعات | `status === 'work'` |
| المخزون | `status === 'work'` **and** not a past day |
| التشيك | `status === 'work'` **and** not a past day |
| أيامي | always |

Work sessions land on Sales and eagerly run `buildSaleUI()`, `loadMyTarget()` then
`loadTodaySales()`, and `loadMyAnalytics()`. Non-work sessions land on My Days.

**`showTab(t)` (L661-671):** lazy-loads stock on first Stock open, checklist on first Check
open, and **reloads My Days on every open**.

### 3.1 Sales tab

**KPI block**

| Element | Source |
|---|---|
| `LAS الجلسة` | count of session sales with `customer_type === 'LAS'` |
| `هدف اليوم` | `targets.daily_target` for this outlet+shift+month, else a dash |
| `SK` | `sale_type` is `SK` **or** `SK+MGM` |
| `MGM` | `sale_type` is `MGM` **or** `SK+MGM` |
| `L.D` | `sale_type === 'LD'` |
| `LAU` | total minus LAS, rendered muted |
| `تحقيق هدف الجلسة` | `round(LAS / daily_target * 100)`, bar capped at 100% |

Bar colour: at or above 100% green, at or above 70% gold, else red. No target shows a dash
and a zero-width bar.

**Sale entry — four grids, then submit**
1. `الجهاز` — 3 columns, labels are `DEV_SHORT`. `pickDev` resets the colour and repaints
   the colour grid for that device.
2. `اللون` — 2 columns, populated only after a device is chosen (`اختر الجهاز أولاً`).
3. `نوع البيع` — `SK`, `MGM`, `SK+MGM`, `LD`.
4. `العميل` — `LAS`, `LAU`.

**`salePick` summary line** repaints on every choice:
`PRIME · Garnet Red · SK · LAS`, with unfilled slots reading `اللون؟` / `نوع البيع؟` / `العميل؟`.

**Business rule enforcement (`pickOpt`, L709-713)**
- Choosing `MGM` or `SK+MGM` while `LAU` is selected is **blocked** with
  `عروض MGM لعملاء LAS فقط`.
- Choosing `LAU` while `MGM`/`SK+MGM` is selected **clears the sale type**.

**`submitSale()` (L722-736)**
- All four selections required, else `أكمل كل الخيارات الأربعة`.
- Inserts one row into `sell_operations`:
  `{attendance_id: session.id, promoter_id, work_date: session.work_date, device_type, color, sale_type, customer_type}`.
- Error gives `خطأ في التسجيل` (generic).
- Success: `تم تسجيل البيع`, stores `window.lastSale`, reveals `كرر آخر عملية`,
  clears the selection, rebuilds the grids, reloads the list and the curve.

**`repeatLast()` (L699-708):** restores the last sale's four values into the UI (does not
submit). `window.lastSale` is memory-only and lost on reload.

**Session list (`loadTodaySales`, L737-777)** — grouped by
`device_type|color|sale_type|customer_type`, sorted by count descending. Each row shows
`PRIME — Garnet Red`, a meta line `SK · LAS`, a count pill, and a delete button. Footer:
`<n> عملية · <k> صنف`. Empty shows `لا مبيعات بعد`.

**`delSale(id)` (L778-785):** `confirm('حذف هذه العملية؟')`, then
`delete().eq('id', ids[0]).eq('promoter_id', profile.id)`. **Deletes one row of the group,
not the group**, then reloads list and curve.

**Month curve (`loadMyAnalytics`, L786-809)** — three parallel queries scoped to the
promoter and the current month:
`sell_operations(work_date) where customer_type='LAS'`, `attendance(work_date,shift,status,touch_point_id)`,
`targets(touch_point_id,shift,daily_target) where month=curMonth()`.
Builds cumulative LAS and cumulative target from day 1 to `ksaDayOfMonth()`; target
accumulates **only on `status === 'work'` days**. Counters: `LAS الشهر`,
`الهدف حتى اليوم` (2dp), `نسبة التحقيق`. Chart.js line chart, gold filled actual against a
dashed grey target (`drawCurve`, L810-828).

### 3.2 End-of-shift report (report #1)

**`genReport()` (L829-874)**
1. Reads `gtInput` as `parseInt(...) || 0`.
2. Fetches this session's sales ordered by `created_at`, plus the outlet+shift+month target.
3. **Arabic confirm dialog** listing outlet, shift, total sales, LAS count, GT, and:
   - `لم تسجّل أي مبيعة اليوم!` when zero sales,
   - achievement line `LAS/target (pct%)` with a red marker below 70%, amber below 100%,
     green at or above.
   Cancelling aborts — nothing is written.
4. On confirm: `attendance.update({guided_trials: gt}).eq('id', session.id)`.
5. Builds the text into `reportBox` (LTR monospace textarea) and reveals it with a
   `نسخ للواتساب` button (`copyText` writes to clipboard, button flips to `تم النسخ`
   for 2s).

**Exact output format:**
```
<full raw touch_points.name>
Date : DD/MM/YYYY
Shift : Day|Night


1. PRIME - Garnet Red | LAS | SK
2. ONE - Leaf Green | LAU | LD
______________________
Total sales : <n>
Guided trials : <gt>
```
Zero sales replaces the numbered list with the single line `No sales`.
Two blank lines after `Shift`. English, LTR, no emoji. Totals derived from the printed list.

### 3.3 Stock tab (report #2)

**`loadStock()` (L876-885):** `stock_catalog.select('*').eq(active,true).order(sort_order)`.
Renders an `الأجهزة` / `TEREA` heading whenever `category` changes, then one row per
item with a numeric input. Labels strip the `IQOS ILUMA i ` and `IQOS ` prefixes.
**Existing quantities are never pre-filled — the inputs always render empty.**

**`submitStock()` (L886-897):** collects non-empty inputs only, requires at least one
(`أدخل كمية لصنف واحد على الأقل`), then
`stock_reports.upsert(rows, { onConflict: 'attendance_id,item_id' })`.
Success shows `تم حفظ <n> صنف`.

**`genStockMsg()` (L898-920)** reads the **DOM inputs**, not the database:
```
Date: DD/MM/YYYY
Outlet: <full raw touch_points.name>
________
IQOS ILUMA PRIME i:
<COLOUR>: <qty>
________
IQOS ILUMA i:
...
________
IQOS ILUMA i ONE:
...
_______
STARTER KITS

<FLAVOUR>: <qty>
```
Grouping is string-matched on `item_name`: `includes('PRIME')`, `includes('ILUMA i —')`,
`includes('ONE')`, `includes('TEREA')`. Colour label is the text after the last em dash,
uppercased. TEREA items print under the heading `STARTER KITS` with the `TEREA ` prefix
stripped.

### 3.4 Checklist tab

**`loadChecklist()` (L921-931):** active items by `sort_order`, plus this promoter's
responses for `session.work_date`. Checked items render with a green tick.

**`toggleCheck(id)` (L932-943):** writes first, then flips the row class —
`checklist_responses.upsert({item_id, promoter_id, work_date, checked: !isDone}, { onConflict: 'item_id,promoter_id,work_date' })`.
Error shows `خطأ — حاول مجدداً`.

### 3.5 My Days tab (backfill)

**`loadDays()` (L944-979):** loads `touch_points` if not already cached, then this
promoter's attendance from the 1st of the month, newest first. Renders **every day from
`ksaDayOfMonth()` down to 1**:
- Registered: `<day> — <Arabic weekday>` with meta `outlet · shift · GT: n` (or the Arabic
  status), a `مبيعاته` button on work rows calling `switchSession(id)`, and a delete
  calling `delDay(id)`.
- Missing: dashed row, red `غير مسجل`, and a `تسجيل` button calling `openBackfill(dt)`.

**`openBackfill(dt)` (L980-1000):** expands an inline mini sign-in form — status grid,
outlet select, shift row — defaulting to `work` / first outlet / first shift, with the same
shift-mode filtering (`bfShiftUI`). `saveBackfill(dt)` inserts the attendance row; `23505`
gives `هذا اليوم مسجل مسبقاً لنفس الفترة`.

**`delDay(id)` (L1031-1037):** confirm, then delete scoped to the promoter. Any error is
reported as `لا يمكن حذف يوم عليه مبيعات — احذف مبيعاته أولاً`. If the deleted row was
today's session, the promoter is returned to `promoterFlow()`.

**`switchSession(attId)` (L1038-1045):** loads that attendance row and re-enters
`openWork()` against it — this is how past-day sales get logged.

---

## 4. Supervisor / manager dashboard (`staffCard`)

**`staffFlow()` (L1065-1078)**
- Header: role label (`المشرف` / `المدير (قراءة فقط)`) and name.
- **Manager only:** city select built from distinct `touch_points.city`, defaulting to
  `profile.city`; the Plan and Admin tabs are hidden.
- Lands on Overview, runs `loadStaffCounts()`.

**Tabs:** نظرة, الفريق, الخطة, إدارة.
**Period row** (`اليوم` / `آخر 7 أيام` / `الشهر`) is visible only on Overview and Team.
`periodStart()` returns `todayStr()`, `bizNow()` minus 6 days, or `curMonth()+'-01'`.

**`loadStaffCounts()` (L1079-1093)** — resolves `city` (manager from the dropdown,
supervisor from `profile.city`), then two `head:true` count queries over `sell_operations`
inner-joined through `attendance` to `touch_points` on city, for LAS and for all. Then fans
out to `loadDashLists(city, start)` and `loadTeamAnalytics(city)`; loads the targets editor
once for supervisors.

### 4.1 Overview

Counters: `مبيعات LAS`, `Guided Trials` (sum of `attendance.guided_trials` over the
period), `تسجيلات` (attendance row count), and a muted `إجمالي النشاط (LAU مشمول)`.
Then the team month curve, then the reports card.

**`loadTeamAnalytics(city)` (L1224-1244):** same cumulative construction as the promoter
curve, city-scoped via `attendance!inner(touch_points!inner(city))` on sales and
`touch_points!inner(city)` on attendance.

### 4.2 Period summary (report #3) — `genSummary()` (L1262-1278)

Reads `window.dashData` cached by `loadDashLists`. Nothing is re-queried.
```
DaTracker — <city> · Daily|Weekly|Monthly Summary
<periodStart> - <todayStr>

LAS sales : <n>
Total activity : <n> (LAU included: <n>)
SK: <n> | MGM: <n> | LD: <n>
Guided trials : <n>
Check-ins : <n>

By promoter (LAS):
1. <name> — <n>

By outlet (LAS):
1. <short outlet> — <n>
```
SK/MGM/LD are summed across promoters, so `SK+MGM` counts in both SK and MGM.

### 4.3 Month CSV (report #4) — `exportCSV()` (L1245-1261)

Current month, city-scoped, ordered by `work_date`. UTF-8 BOM, every cell quoted with
embedded quotes doubled. Header:
`Date, Promoter, Outlet, Shift, Device, Color, Sale Type, Customer, Entered At`
(`Entered At` is `created_at` via `toLocaleString('en-GB')`; outlet is the full raw name).
Filename `DaTracker_<city>_<YYYY-MM>.csv`, downloaded via an object URL.

### 4.4 Team tab — eight accordions

| Accordion | Default | Content |
|---|---|---|
| التسجيل + تحقيق الهدف (LAS) | open | `loadFillWidget` |
| مبيعات المندوبين | open | per-promoter LAS with SK / MGM / LD / LAU meta |
| مبيعات المواقع | closed | per-outlet LAS, LAU meta when non-zero |
| المبيعات حسب الجهاز | closed | `renderDevBreak` |
| الحضور | closed | attendance rows, GT, supervisor delete |
| جرد المواقع (الفترة) | closed | `loadStockView` |
| التشيك ليست اليوم | closed | `loadCheckView` |
| آخر العمليات | closed | `loadSalesFeed`, last 20 |

**`loadFillWidget(city)` (L1094-1141)** — the morning "who is behind" widget. Active
promoters in the city, then month-to-date attendance, sales, and targets. Per promoter:
- `أيام مسجلة` = distinct attendance dates over `ksaDayOfMonth()`; a tick when complete
  else a warning; green at 100%, gold at 70% or above, red below.
- `هدف LAS` = LAS count over accumulated target (`work` days only), with a percentage and
  the same three-colour scale. No target shows a muted dash.
Sorted by days-logged ascending, so the least-compliant promoter is first.

**`loadDashLists(city, start)` (L1142-1194)**
- Attendance: `select('id,shift,status,guided_trials,checked_in_at,work_date,users(full_name,city),touch_points(name,city)').gte('work_date', start).order('checked_in_at')` —
  **no server-side city filter**; filtered client-side by `touch_points.city`, falling back
  to `users.city` for leave rows that have no outlet.
- Sales: `select('sale_type,customer_type,device_type,color,promoter_id,users(full_name),attendance!inner(touch_points!inner(name,city))')`, city-scoped server-side.
- Builds `by[promoter]` as `{las, lau, sk, mgm, ld}` and `byOut[outlet]` as `{las, lau}`,
  caches everything into `window.dashData`, then triggers the stock/check/feed loaders and,
  for supervisors, reveals and loads all four admin cards plus the route plan and tasks.

**`renderDevBreak(sales)` (L1195-1223):** share-of-total bars per device (palette
`var(--gold)`, `#7fb2d8`, `#c98fd0`) then a top-8 `أعلى الألوان` list of `DEVICE — Colour`
with counts.

**`loadStockView(city, start)` (L1279-1295):** stock reports where
`reported_at >= start + 'T00:00:00'`, city-scoped, newest first, grouped by outlet into a
collapsible row showing item count and last-update time (`toLocaleTimeString('ar-SA')`).

**`loadCheckView(city)` (L1296-1310):** count of active checklist items, and today's
responses joined to `users!inner(full_name, city)`. Renders `<checked>/<total>` per
promoter, green when complete. **Promoters with no responses at all do not appear.**

**`loadSalesFeed(city, start)` (L1311-1322):** last 20 sales by `created_at` desc with
promoter, device, colour, type, customer, short outlet and `work_date`. Supervisors get a
delete calling `supDelSale(id)` (confirm, unscoped delete, then full reload).

**`supDelAtt(id)` (L1504-1510):** confirm, delete; on error alerts
`لا يمكن الحذف — عليه مبيعات مسجلة. احذف مبيعاته من آخر العمليات أولاً.`

### 4.5 Plan tab (supervisor only)

**Tasks card (`sup_tasks`)** — `loadTasks` L1721-1741, private to `owner_id`.
Ordered by `done`, `kind`, `id`. Badges: weekly shows the Arabic weekday plus `اليوم` when
it matches today; once shows the due date with a red pill when overdue and not done; daily
shows `يومي`. Footer `<pending> متبقية من <total>`. Add form takes a title and a kind
(`daily`/`weekly`/`once`), revealing a weekday select or a due-date input. `toggleTask`,
`delTask` (confirm), `resetTasks` (confirm, clears every `done` flag for this owner).
Query failure renders `شغّل سكربت الجداول أولاً`.

**Route plan** — `rpDate` defaults to **tomorrow** (`bizNow()` plus 1 day, `initRoutePlan`
L1344-1349); changing it reloads.

**`loadRoutePlan()` (L1350-1385):** active city outlets, active city promoters, and every
`route_plans` row for that date. One select per promoter with
`— بدون —`, an `الحالة` optgroup (4 leave statuses) and a `المواقع` optgroup listing
`<short outlet> — <shift>` for each shift the outlet actually runs. Current value is
preselected.

**`saveRoutePlan()` (L1397-1444)**
1. Requires a date.
2. **Validates before writing:** two promoters on the same outlet+shift is a hard error
   `<outlet> — <shift> معيّن له أكثر من مندوب`, and nothing is written.
   *(This contradicts `BUSINESS_RULES.md`, which says warn-but-allow — see findings.)*
3. **Upsert first** (`onConflict: 'plan_date,promoter_id'`), with named Arabic messages for
   `42P10`, `PGRST204`, `23505`, `23514`, `42501`/RLS, `23503`, and a fallback carrying the
   raw message.
4. **Then delete** rows for promoters set back to `— بدون —`. A failed delete reports
   `حُفظت التعيينات لكن تعذّر مسح المندوبين المستبعدين`.
5. Success shows `حُفظت خطة <date> (<n> تعيين)`.

### 4.6 Route-plan message (report #5) — `genRouteMsg()` (L1445-1503)

Reads the **dropdowns**, not the database — an unsaved edit still generates.
Requires at least one outlet assignment (`عيّن مندوباً واحداً على الأقل أولاً`).
Outlets split into normal and `is_ds`. Per outlet block:
```
<unicode, oneLine 24>       (omitted when empty)
<full name, oneLine 70>
<firstUrl(maps_url)>        (omitted when empty/invalid)

Day : name / name
Night : name
```
Shift lines print for the shifts the outlet runs **plus** any shift that has someone
assigned. Blocks are joined by blank line, `==========`, blank line. DS outlets follow
after two blank lines under a `====DS====` header.
```
<City> RP
DD/MM/YYYY


<normal blocks>


====DS====

<ds blocks>

==========

Total active : <count of names actually printed>
Inactive : <n>
<name> ::: Off|Sick leave|Annual leave|Absent
```
`Total active` is summed from the printed lists. Anyone with no pick at all is listed as
`Off`.

### 4.7 Admin tab (supervisor only)

**Targets editor** (`loadTargetsEditor` L1673-1689, `saveTargets` L1690-1709) — one row per
active outlet **per shift the outlet runs**, with `مبيعات` and `GT` inputs prefilled from
`targets` for `curMonth()`. Save upserts every non-empty sales target on
`touch_point_id,shift,month`; GT defaults to 0 when blank. Heading shows `curMonthName()`.

**Users** (`loadUsers` L1775-1806) — city-scoped, ordered by role then name. Each row shows
name, `login_no` (LTR), Arabic role, active state; an edit toggle opens an inline editor
(full name plus 4-digit login number) and a stop/activate button. Saving warns that the
login number is **display only** and the real email must change in Supabase. A standing
note states the password is hashed and resettable only from the Supabase dashboard.
- **Spare accounts:** inactive promoter rows. When any exist, a `تفعيل حساب شاغر` block
  appears; `claimSpare()` renames, activates and re-cities the chosen row. When none exist,
  an instruction block points at Supabase, Authentication, Add user.

**Team logins (report #6)** — `genRosterMsg()` (L1833-1845):
```
<City> - TEAM LOGINS
DD/MM/YYYY
==========

مندوب
• <name> — <login_no>

مشرف
• <name> — <login_no>

==========
Passwords are not listed here.
```
Active users only, grouped promoter, supervisor, manager.

**Outlets** (`loadTpManager` L1511-1565) — every outlet in the city, active first. Meta
line: unicode, shift mode, DS tag, map pin, active state. Edit expands a form for name,
unicode, maps URL, shift mode, DS flag, and this month's day/night targets (rows shown per
mode). `saveTpEdit` (L1582-1615) sanitises name (`oneLine` 70), unicode (`oneLine` 24) and
URL (`firstUrl`, rejecting non-URLs with
`رابط الخريطة غير صالح — يجب أن يبدأ بـ https://`), writes `shift_mode` **and** keeps the
legacy `dual_shift` boolean in sync, then upserts targets only for the shifts the outlet
runs. `23505` gives `الاسم مستخدم`.
`addTp` (L1616-1645) applies the same sanitisation and optionally inserts targets.
`toggleTp` flips `active`. All three refresh the targets editor and reset `rpInited`.

**Checklist items** (`loadClManager` L1651-1672) — list active items, add a new one
(`created_by = profile.id`), and delete which **soft-deletes** via `active = false` after a
confirm.

---

## 5. Every Supabase query, by table

| Table | Reads | Writes |
|---|---|---|
| `users` | `route` (self), `loadFillWidget`, `loadRoutePlan`, `loadUsers`, joins in attendance/sales/checklist/feed | `claimSpare`, `saveUsr`, `toggleUsr` |
| `touch_points` | `promoterFlow`, `loadDays`, `staffFlow` (cities), `loadRoutePlan`, `loadTpManager`, `loadTargetsEditor`, joins | `addTp`, `saveTpEdit`, `toggleTp` |
| `attendance` | `promoterFlow`, `setSigninDate`, `switchSession`, `loadDays`, `loadMyAnalytics`, `loadDashLists`, `loadFillWidget`, `loadTeamAnalytics` | `doSignin`, `saveBackfill`, `genReport` (guided_trials), `delDay`, `supDelAtt` |
| `sell_operations` | `loadTodaySales`, `genReport`, `loadMyAnalytics`, `loadStaffCounts` x2, `loadDashLists`, `loadTeamAnalytics`, `exportCSV`, `loadSalesFeed`, `loadFillWidget` | `submitSale`, `delSale`, `supDelSale` |
| `targets` | `loadMyTarget`, `genReport`, `loadMyAnalytics`, `loadFillWidget`, `loadTeamAnalytics`, `loadTpManager`, `loadTargetsEditor` | `saveTargets`, `saveTpEdit`, `addTp` |
| `route_plans` | `setSigninDate`, `loadRoutePlan` | `saveRoutePlan` (upsert then delete) |
| `stock_catalog` | `loadStock` | — |
| `stock_reports` | `loadStockView` | `submitStock` (upsert) |
| `checklist_items` | `loadChecklist`, `loadCheckView`, `loadClManager` | `addClItem`, `delClItem` (soft) |
| `checklist_responses` | `loadChecklist`, `loadCheckView` | `toggleCheck` (upsert) |
| `sup_tasks` | `loadTasks` | `addTask`, `toggleTask`, `delTask`, `resetTasks` |

---

## 6. Tap counts (baseline for the two-tap goal)

| Flow | Taps today |
|---|---|
| Sign in for the day (route plan set, outlet correct) | **1** — `تسجيل اليوم` |
| Sign in when the outlet must be changed | 3 — open select, pick, submit |
| Log a sale, cold | **5** — device, colour, type, customer, submit |
| Log an identical repeat sale | **2** — `كرر آخر عملية`, submit |
| Delete a sale | 2 — delete, confirm |
| Generate and copy end-of-shift report | 4 — GT field, generate, confirm dialog, copy |
| Backfill a missing day | 4 — Days tab, `تسجيل`, (status/outlet/shift if not default), save |
| Save the route plan | 1 plus one select per promoter |

---

## 7. All eight confirm dialogs

`delSale`, `delDay`, `supDelSale`, `supDelAtt`, `delClItem`, `delTask`, `resetTasks`, and
the end-of-shift report verification dialog — the only one that is not a deletion.
