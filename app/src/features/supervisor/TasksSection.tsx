/**
 * The shared to-do list.
 *
 * Lived inside the Admin tab until it moved here, which is why it was hard to
 * find: four accordions deep, on the fifth tab, behind a heading about
 * targets and outlets. The list itself did not change — only where it lives.
 *
 * Reminders and notes are the same job from the user's side: things to
 * remember. They now sit on one screen.
 *
 * Since migration 003 the list is shared between the supervisor and the
 * manager, so each row shows who added it and either of them can tick or
 * delete any item. A shared list where only the author can close things is not
 * a shared list.
 */

import { useState, type ReactNode } from 'react';
import { businessToday } from '../../lib/businessDay';
import { TASK_KIND_LABEL, WEEKDAY_LABEL } from '../../domain/labels';
import { TaskKind } from '../../domain/values';
import { isOverdue, type SupTask } from '../../data/tasks';

export interface TasksSectionProps {
  readonly tasks: readonly SupTask[];
  /** Names by user id, so a shared item can say who asked for it. */
  readonly names: ReadonlyMap<string, string>;
  /** Whoever is looking. Their own items carry no "from" badge. */
  readonly currentUserId: string;
  readonly busy: boolean;
  readonly onAdd: (title: string, kind: SupTask['kind'], weekday: number | null) => void;
  readonly onToggle: (id: number, done: boolean) => void;
  readonly onRemove: (id: number) => void;
  readonly onReset: () => void;
}

export function TasksSection({
  tasks,
  names,
  currentUserId,
  busy,
  onAdd,
  onToggle,
  onRemove,
  onReset,
}: TasksSectionProps) {
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
              <span className="flex-1 min-w-0">
                <span
                  className={`block truncate text-sm ${task.done ? 'text-muted line-through' : 'text-ink'}`}
                >
                  {task.title}
                </span>
                {/* The list is shared, so an item nobody claims is an item
                    nobody chases. Own items stay unlabelled — that would be
                    noise on every row. */}
                {task.ownerId !== '' && task.ownerId !== currentUserId && (
                  <span className="block truncate text-xs text-faint">
                    من {names.get(task.ownerId) ?? '—'}
                  </span>
                )}
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

function Empty({ children }: { children: ReactNode }) {
  return <p className="py-3 text-center text-sm text-faint">{children}</p>;
}
