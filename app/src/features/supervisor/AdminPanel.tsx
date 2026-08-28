/**
 * Admin: targets, outlets, users, tasks.
 *
 * Four accordions, all collapsed by default. This is the least-visited surface
 * and the most destructive one, so nothing here is a tap away by accident.
 *
 * The users section states plainly what the app cannot do. Passwords are bcrypt
 * hashes and can never be displayed; changing a login number here does not
 * change the email the person actually types. Both are facts a supervisor will
 * otherwise discover by finding out something did not work.
 */

import { useState, type ReactNode } from 'react';
import { businessMonth, businessToday } from '../../lib/businessDay';
import { MONTH_LABEL, ROLE_LABEL, SHIFT_LABEL, TASK_KIND_LABEL, WEEKDAY_LABEL } from '../../domain/labels';
import { shiftsFor } from '../../domain/rules';
import { shortOutletName } from '../../domain/text';
import { Role, TaskKind, type Shift } from '../../domain/values';
import type { Outlet } from '../../data/outlets';
import type { TeamMember } from '../../data/supervisor';
import { isOverdue, type SupTask } from '../../data/tasks';
import { buildTeamLogins } from '../reports/teamLogins';
import { targetKey, type TargetTable } from '../../data/targets';

export interface AdminPanelProps {
  readonly city: string;
  readonly outlets: readonly Outlet[];
  readonly targets: TargetTable;
  readonly team: readonly TeamMember[];
  readonly tasks: readonly SupTask[];
  readonly busy: boolean;
  readonly notice: string | null;
  readonly onSaveTargets: (
    entries: readonly { touchPointId: number; shift: Shift; dailyTarget: number; gtTarget: number }[],
  ) => void;
  readonly onToggleOutlet: (id: number, active: boolean) => void;
  readonly onSaveMember: (id: string, fullName: string, loginNumber: string) => void;
  readonly onToggleMember: (id: string, active: boolean) => void;
  readonly onAddTask: (title: string, kind: SupTask['kind'], weekday: number | null) => void;
  readonly onToggleTask: (id: number, done: boolean) => void;
  readonly onRemoveTask: (id: number) => void;
  readonly onResetTasks: () => void;
}

export function AdminPanel(props: AdminPanelProps) {
  const monthName = (() => {
    const month = businessMonth();
    const index = Number(month.slice(5, 7)) - 1;
    return `${MONTH_LABEL[index] ?? month} ${month.slice(0, 4)}`;
  })();

  return (
    <div className="space-y-2">
      {props.notice !== null && (
        <p className="rounded-control border border-achieved/30 bg-achieved/10 px-3 py-2 text-sm text-achieved">
          {props.notice}
        </p>
      )}

      <Accordion title={`أهداف ${monthName}`}>
        <TargetsSection
          outlets={props.outlets}
          targets={props.targets}
          busy={props.busy}
          onSave={props.onSaveTargets}
        />
      </Accordion>

      <Accordion title="المواقع" count={props.outlets.length}>
        <OutletsSection outlets={props.outlets} busy={props.busy} onToggle={props.onToggleOutlet} />
      </Accordion>

      <Accordion title="المستخدمون" count={props.team.length}>
        <UsersSection
          city={props.city}
          team={props.team}
          busy={props.busy}
          onSave={props.onSaveMember}
          onToggle={props.onToggleMember}
        />
      </Accordion>

      <Accordion title="متابعاتي" count={props.tasks.filter((t) => !t.done).length}>
        <TasksSection
          tasks={props.tasks}
          busy={props.busy}
          onAdd={props.onAddTask}
          onToggle={props.onToggleTask}
          onRemove={props.onRemoveTask}
          onReset={props.onResetTasks}
        />
      </Accordion>
    </div>
  );
}

// ---------------------------------------------------------------------------

function TargetsSection({
  outlets,
  targets,
  busy,
  onSave,
}: {
  outlets: readonly Outlet[];
  targets: TargetTable;
  busy: boolean;
  onSave: AdminPanelProps['onSaveTargets'];
}) {
  const [draft, setDraft] = useState<Record<string, { sales: string; gt: string }>>(() => {
    const initial: Record<string, { sales: string; gt: string }> = {};
    for (const outlet of outlets) {
      for (const shift of shiftsFor(outlet.shiftMode)) {
        const key = targetKey(outlet.id, shift);
        const existing = targets.get(key);
        initial[key] = {
          sales: existing !== undefined ? String(existing.dailyTarget) : '',
          gt: existing !== undefined ? String(existing.gtTarget) : '',
        };
      }
    }
    return initial;
  });

  const setValue = (key: string, field: 'sales' | 'gt', value: string) => {
    const cleaned = value.replace(/[^\d.]/gu, '');
    setDraft((current) => ({
      ...current,
      [key]: { ...(current[key] ?? { sales: '', gt: '' }), [field]: cleaned },
    }));
  };

  const save = () => {
    const entries: { touchPointId: number; shift: Shift; dailyTarget: number; gtTarget: number }[] = [];
    for (const outlet of outlets) {
      for (const shift of shiftsFor(outlet.shiftMode)) {
        const key = targetKey(outlet.id, shift);
        const value = draft[key];
        if (value === undefined || value.sales.trim() === '') continue;
        const dailyTarget = Number(value.sales);
        if (!Number.isFinite(dailyTarget)) continue;
        const gt = Number(value.gt);
        entries.push({
          touchPointId: outlet.id,
          shift,
          dailyTarget,
          gtTarget: Number.isFinite(gt) ? gt : 0,
        });
      }
    }
    onSave(entries);
  };

  if (outlets.length === 0) return <Empty>لا مواقع</Empty>;

  return (
    <>
      <div className="mb-2 flex items-center justify-between gap-2 text-xs text-muted">
        <span>الموقع</span>
        <span className="flex gap-2">
          <span className="w-16 text-center">مبيعات</span>
          <span className="w-14 text-center">GT</span>
        </span>
      </div>

      {outlets.flatMap((outlet) =>
        shiftsFor(outlet.shiftMode).map((shift) => {
          const key = targetKey(outlet.id, shift);
          const value = draft[key] ?? { sales: '', gt: '' };
          return (
            <div
              key={key}
              className="flex items-center justify-between gap-2 border-b border-line-soft py-2"
            >
              <span className="min-w-0 flex-1 truncate text-sm text-ink">
                {shortOutletName(outlet.name)} — {SHIFT_LABEL[shift]}
              </span>
              <span className="flex shrink-0 gap-2">
                <input
                  type="text"
                  inputMode="decimal"
                  value={value.sales}
                  onChange={(event) => setValue(key, 'sales', event.target.value)}
                  aria-label={`هدف مبيعات ${shortOutletName(outlet.name)} ${SHIFT_LABEL[shift]}`}
                  dir="ltr"
                  className="tabular h-11 w-16 rounded-control border border-line-soft bg-surface-raised text-center text-sm text-ink"
                />
                <input
                  type="text"
                  inputMode="decimal"
                  value={value.gt}
                  onChange={(event) => setValue(key, 'gt', event.target.value)}
                  aria-label={`هدف GT ${shortOutletName(outlet.name)} ${SHIFT_LABEL[shift]}`}
                  dir="ltr"
                  className="tabular h-11 w-14 rounded-control border border-line-soft bg-surface-raised text-center text-sm text-ink"
                />
              </span>
            </div>
          );
        }),
      )}

      <button
        type="button"
        onClick={save}
        disabled={busy}
        className="mt-4 min-h-tap w-full rounded-control bg-gradient-to-br from-gold-hi via-gold to-gold-lo font-bold text-on-gold disabled:opacity-40"
      >
        حفظ الأهداف
      </button>
    </>
  );
}

// ---------------------------------------------------------------------------

function OutletsSection({
  outlets,
  busy,
  onToggle,
}: {
  outlets: readonly Outlet[];
  busy: boolean;
  onToggle: (id: number, active: boolean) => void;
}) {
  if (outlets.length === 0) return <Empty>لا مواقع</Empty>;

  return (
    <ul className="space-y-2">
      {outlets.map((outlet) => (
        <li
          key={outlet.id}
          className={`flex items-center justify-between gap-3 rounded-control border border-line-soft bg-surface-raised px-3 py-2 ${
            outlet.active ? '' : 'opacity-50'
          }`}
        >
          <div className="min-w-0">
            <p className="truncate text-sm text-ink">{outlet.shortName}</p>
            <p className="truncate text-xs text-muted">
              {outlet.unicode !== null && (
                <span className="tabular" dir="ltr">
                  {outlet.unicode} ·{' '}
                </span>
              )}
              {shiftsFor(outlet.shiftMode).map((s) => SHIFT_LABEL[s]).join(' + ')}
              {outlet.isDs && ' · DS'}
              {outlet.mapsUrl !== null && ' · 📍'}
            </p>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => onToggle(outlet.id, !outlet.active)}
            className="min-h-tap shrink-0 rounded-control border border-line px-3 text-xs text-muted disabled:opacity-40"
          >
            {outlet.active ? 'إيقاف' : 'تفعيل'}
          </button>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------

function UsersSection({
  city,
  team,
  busy,
  onSave,
  onToggle,
}: {
  city: string;
  team: readonly TeamMember[];
  busy: boolean;
  onSave: (id: string, fullName: string, loginNumber: string) => void;
  onToggle: (id: string, active: boolean) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [login, setLogin] = useState('');
  const [roster, setRoster] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const startEdit = (member: TeamMember) => {
    setEditing(member.id);
    setName(member.fullName);
    setLogin(member.loginNumber ?? '');
  };

  const generateRoster = () => {
    setRoster(
      buildTeamLogins({
        city,
        members: team
          .filter((member) => Role.is(member.role))
          .map((member) => ({
            fullName: member.fullName,
            role: member.role as ReturnType<typeof Role.parse>,
            loginNumber: member.loginNumber,
            active: member.active,
          })),
        today: businessToday(),
      }),
    );
    setCopied(false);
  };

  if (team.length === 0) return <Empty>لا مستخدمين</Empty>;

  return (
    <>
      <p className="mb-3 rounded-control border border-line-soft bg-surface-raised px-3 py-2 text-xs leading-relaxed text-muted">
        كلمة المرور مشفّرة ولا يمكن عرضها — تُعاد فقط من لوحة Supabase. رقم الدخول هنا
        للعرض فقط؛ تغييره لا يغيّر ما يكتبه المستخدم عند الدخول.
      </p>

      <ul className="space-y-2">
        {team.map((member) => (
          <li
            key={member.id}
            className={`rounded-control border border-line-soft bg-surface-raised px-3 py-2 ${
              member.active ? '' : 'opacity-50'
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm text-ink">{member.fullName}</p>
                <p className="truncate text-xs text-muted">
                  <span className="tabular" dir="ltr">
                    {member.loginNumber ?? '—'}
                  </span>
                  {' · '}
                  {ROLE_LABEL[member.role as keyof typeof ROLE_LABEL] ?? member.role}
                  {' · '}
                  {member.active ? 'نشط' : 'موقوف'}
                </p>
              </div>
              <span className="flex shrink-0 gap-1.5">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setEditing(editing === member.id ? null : member.id)}
                  onFocus={() => startEdit(member)}
                  className="min-h-tap rounded-control border border-gold px-3 text-xs text-gold disabled:opacity-40"
                >
                  تعديل
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onToggle(member.id, !member.active)}
                  className="min-h-tap rounded-control border border-line px-3 text-xs text-muted disabled:opacity-40"
                >
                  {member.active ? 'إيقاف' : 'تفعيل'}
                </button>
              </span>
            </div>

            {editing === member.id && (
              <div className="mt-3 border-t border-line-soft pt-3">
                <label className="mb-1.5 block text-xs text-muted">الاسم الكامل</label>
                <input
                  type="text"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="min-h-tap w-full rounded-control border border-line-soft bg-surface px-3 text-sm text-ink"
                />
                <label className="mt-3 mb-1.5 block text-xs text-muted">رقم الدخول</label>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={4}
                  value={login}
                  onChange={(event) => setLogin(event.target.value.replace(/\D/gu, ''))}
                  dir="ltr"
                  className="tabular min-h-tap w-full rounded-control border border-line-soft bg-surface px-3 text-center text-sm text-ink"
                />
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    onSave(member.id, name, login);
                    setEditing(null);
                  }}
                  className="mt-3 min-h-tap w-full rounded-control bg-gradient-to-br from-gold-hi via-gold to-gold-lo text-sm font-bold text-on-gold disabled:opacity-40"
                >
                  حفظ
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={generateRoster}
        className="mt-4 min-h-tap w-full rounded-control border border-gold text-sm font-bold text-gold"
      >
        توليد قائمة الأرقام
      </button>

      {roster !== null && (
        <div className="mt-3">
          <textarea
            value={roster}
            onChange={(event) => setRoster(event.target.value)}
            rows={12}
            className="report-text w-full rounded-control border border-line-soft bg-surface-raised p-3 text-sm text-ink"
          />
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(roster).then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 2000);
              });
            }}
            className="mt-2 min-h-tap w-full rounded-control bg-gradient-to-br from-gold-hi via-gold to-gold-lo font-bold text-on-gold"
          >
            {copied ? 'تم النسخ' : 'نسخ'}
          </button>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

function TasksSection({
  tasks,
  busy,
  onAdd,
  onToggle,
  onRemove,
  onReset,
}: {
  tasks: readonly SupTask[];
  busy: boolean;
  onAdd: (title: string, kind: SupTask['kind'], weekday: number | null) => void;
  onToggle: (id: number, done: boolean) => void;
  onRemove: (id: number) => void;
  onReset: () => void;
}) {
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<SupTask['kind']>('daily');
  const [weekday, setWeekday] = useState(0);
  const today = businessToday();

  return (
    <>
      {tasks.length === 0 ? (
        <Empty>لا مهام — أضف أول مهمة</Empty>
      ) : (
        <ul className="mb-4">
          {tasks.map((task) => (
            <li
              key={task.id}
              className="flex items-center gap-2 border-b border-line-soft py-1.5 last:border-0"
            >
              {/*
                The visual box stays 24px, but the tappable area is a full 48.
                A 24px target is a miss waiting to happen on a phone, and the
                miss here silently marks the wrong task done.
              */}
              <button
                type="button"
                disabled={busy}
                onClick={() => onToggle(task.id, !task.done)}
                aria-pressed={task.done}
                aria-label={task.title}
                className="flex min-h-tap w-9 shrink-0 items-center justify-center disabled:opacity-40"
              >
                <span
                  aria-hidden="true"
                  className={`flex h-6 w-6 items-center justify-center rounded-lg border text-sm ${
                    task.done
                      ? 'border-achieved bg-achieved/10 text-achieved'
                      : 'border-line text-transparent'
                  }`}
                >
                  ✓
                </span>
              </button>
              <span className={`flex-1 text-sm ${task.done ? 'text-muted line-through' : 'text-ink'}`}>
                {task.title}
              </span>
              <span
                className={`shrink-0 rounded-full border px-2 py-0.5 text-xs ${
                  isOverdue(task, today)
                    ? 'border-behind/30 bg-behind/10 text-behind'
                    : 'border-line-soft text-muted'
                }`}
              >
                {task.kind === 'weekly'
                  ? (WEEKDAY_LABEL[task.weekday ?? 0] ?? '')
                  : task.kind === 'once'
                    ? (task.dueDate ?? TASK_KIND_LABEL.once)
                    : TASK_KIND_LABEL.daily}
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => onRemove(task.id)}
                aria-label={`حذف ${task.title}`}
                className="min-h-tap w-9 shrink-0 text-behind disabled:opacity-40"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      <label htmlFor="task-title" className="mb-1.5 block text-xs text-muted">
        إضافة مهمة
      </label>
      <input
        id="task-title"
        type="text"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="مثال: مراجعة تقرير المبيعات"
        className="min-h-tap w-full rounded-control border border-line-soft bg-surface-raised px-3 text-sm text-ink"
      />

      <div className="mt-2 grid grid-cols-3 gap-2">
        {TaskKind.values.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={kind === option}
            onClick={() => setKind(option)}
            className={`min-h-tap rounded-control border text-xs transition-colors ${
              kind === option
                ? 'border-gold bg-gold/10 font-bold text-gold'
                : 'border-line-soft bg-surface-raised text-ink'
            }`}
          >
            {TASK_KIND_LABEL[option]}
          </button>
        ))}
      </div>

      {kind === 'weekly' && (
        <select
          value={weekday}
          onChange={(event) => setWeekday(Number(event.target.value))}
          aria-label="يوم الأسبوع"
          className="mt-2 min-h-tap w-full rounded-control border border-line-soft bg-surface-raised px-3 text-sm text-ink"
        >
          {WEEKDAY_LABEL.map((label, index) => (
            <option key={label} value={index}>
              {label}
            </option>
          ))}
        </select>
      )}

      <button
        type="button"
        disabled={busy || title.trim() === ''}
        onClick={() => {
          onAdd(title, kind, kind === 'weekly' ? weekday : null);
          setTitle('');
        }}
        className="mt-2 min-h-tap w-full rounded-control bg-gradient-to-br from-gold-hi via-gold to-gold-lo text-sm font-bold text-on-gold disabled:opacity-40"
      >
        إضافة
      </button>

      {tasks.some((task) => task.done) && (
        <button
          type="button"
          disabled={busy}
          onClick={onReset}
          className="mt-2 min-h-tap w-full rounded-control border border-line text-xs text-muted disabled:opacity-40"
        >
          إعادة تعيين العلامات
        </button>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

function Accordion({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <details className="overflow-hidden rounded-card border border-line bg-surface">
      <summary className="flex min-h-tap cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-bold text-ink">
        <span>{title}</span>
        {count !== undefined && (
          <span className="tabular text-xs font-normal text-muted" dir="ltr">
            {count}
          </span>
        )}
      </summary>
      <div className="px-4 pb-4">{children}</div>
    </details>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="py-4 text-center text-sm text-faint">{children}</p>;
}
