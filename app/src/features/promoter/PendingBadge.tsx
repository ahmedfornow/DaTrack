/**
 * The visible pending count.
 *
 * Without this the queue is invisible, and an invisible queue is barely better
 * than losing the sale: the promoter has no way to know whether their shift's
 * work has actually reached anyone. It shows only when something is waiting, so
 * a normal shift never sees it.
 *
 * Parked failures are shown separately and in red. Those will not resolve on
 * their own and need a person, which is a different message from "waiting for
 * signal".
 */

export interface PendingBadgeProps {
  readonly pending: number;
  readonly failed: number;
  readonly online: boolean;
  readonly onRetry: () => void;
}

export function PendingBadge({ pending, failed, online, onRetry }: PendingBadgeProps) {
  if (pending === 0 && failed === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="mb-3 rounded-control border border-close/30 bg-close/10 px-3 py-2"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          {pending > 0 && (
            <p className="text-sm text-close">
              <span className="tabular font-bold">{pending}</span>{' '}
              {pending === 1 ? 'عملية بانتظار الإرسال' : 'عمليات بانتظار الإرسال'}
            </p>
          )}
          {failed > 0 && (
            <p className="text-sm text-behind">
              <span className="tabular font-bold">{failed}</span>{' '}
              {failed === 1 ? 'عملية فشلت' : 'عمليات فشلت'} — كلّم المشرف
            </p>
          )}
          <p className="mt-0.5 text-xs text-muted">
            {online
              ? 'محفوظة على جهازك وتُرسل تلقائياً'
              : 'لا يوجد اتصال — محفوظة على جهازك ولن تضيع'}
          </p>
        </div>

        {online && (
          <button
            type="button"
            onClick={onRetry}
            className="min-h-tap shrink-0 rounded-control border border-close px-3 text-xs font-bold text-close"
          >
            إرسال الآن
          </button>
        )}
      </div>
    </div>
  );
}
