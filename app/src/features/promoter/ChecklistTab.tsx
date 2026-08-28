/**
 * The mandatory daily checklist.
 *
 * Ticks are optimistic — the row flips immediately and reverts if the write
 * fails. A checkbox that waits on the network before responding feels broken,
 * and the promoter taps it again.
 */

import type { ChecklistItem } from '../../data/checklist';

export interface ChecklistTabProps {
  readonly items: readonly ChecklistItem[];
  readonly checked: ReadonlySet<number>;
  readonly busy: boolean;
  readonly onToggle: (itemId: number, next: boolean) => void;
}

export function ChecklistTab({ items, checked, busy, onToggle }: ChecklistTabProps) {
  if (items.length === 0) {
    return (
      <p className="rounded-card border border-dashed border-line-soft px-4 py-6 text-center text-sm text-faint">
        لا بنود
      </p>
    );
  }

  const done = items.filter((item) => checked.has(item.id)).length;

  return (
    <section className="rounded-card border border-line bg-surface p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-md font-bold text-ink">التشيك ليست الإلزامية</h2>
        <p
          className={`tabular text-xs ${done === items.length ? 'text-achieved' : 'text-muted'}`}
          dir="ltr"
        >
          {done}/{items.length}
        </p>
      </div>

      <ul className="mt-2">
        {items.map((item) => {
          const isDone = checked.has(item.id);
          return (
            <li key={item.id} className="border-b border-line-soft last:border-0">
              <button
                type="button"
                disabled={busy}
                onClick={() => onToggle(item.id, !isDone)}
                aria-pressed={isDone}
                className="flex min-h-tap w-full items-center gap-3 py-2 text-right disabled:opacity-50"
              >
                <span
                  aria-hidden="true"
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border text-sm ${
                    isDone
                      ? 'border-achieved bg-achieved/10 text-achieved'
                      : 'border-line text-transparent'
                  }`}
                >
                  ✓
                </span>
                <span className={`text-sm ${isDone ? 'text-muted line-through' : 'text-ink'}`}>
                  {item.title}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
