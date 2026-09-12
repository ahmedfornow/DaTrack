/**
 * Notes and reminders — one screen for things to remember.
 *
 * The to-do list already existed; it was buried four accordions deep on the
 * Admin tab, next to outlet management. Notes are new. Both answer the same
 * question, so they share a tab.
 *
 * There is no autosave. A note that saves while you type is a note that saves
 * a half-written sentence, and on a phone in a shop the difference between
 * "saved" and "saving" is not something to guess at — the button says which.
 * Editing is explicit for the same reason: tapping a note opens it, and
 * nothing is written until Save.
 */

import { useState } from 'react';
import { ksaClockTimeOf } from '../../lib/businessDay';
import { MAX_NOTE_LENGTH, noteTitle, notePreview, type Note } from '../../data/notes';
import { TasksSection, type TasksSectionProps } from './TasksSection';

export interface NotesPanelProps {
  readonly notes: readonly Note[];
  readonly busy: boolean;
  readonly notice: string | null;
  readonly onCreate: (body: string) => void;
  readonly onUpdate: (id: number, body: string) => void;
  readonly onRemove: (id: number) => void;
  /** Omitted for a manager: `sup_tasks` is the supervisor's own list. */
  readonly tasks?: TasksSectionProps | undefined;
}

export function NotesPanel({
  notes,
  busy,
  notice,
  onCreate,
  onUpdate,
  onRemove,
  tasks,
}: NotesPanelProps) {
  /** `null` = nothing open, `'new'` = the composer, a number = editing that note. */
  const [open, setOpen] = useState<number | 'new' | null>(null);
  const [draft, setDraft] = useState('');
  const [confirming, setConfirming] = useState<number | null>(null);

  const startNew = () => {
    setOpen('new');
    setDraft('');
    setConfirming(null);
  };

  const startEdit = (note: Note) => {
    setOpen(note.id);
    setDraft(note.body);
    setConfirming(null);
  };

  const close = () => {
    setOpen(null);
    setDraft('');
  };

  const save = () => {
    if (draft.trim() === '') return;
    if (open === 'new') onCreate(draft);
    else if (typeof open === 'number') onUpdate(open, draft);
    close();
  };

  return (
    <div className="space-y-2">
      {notice !== null && (
        <p className="rounded-control border border-achieved/30 bg-achieved/10 px-3 py-2 text-sm text-achieved">
          {notice}
        </p>
      )}

      {/* --- Notes ------------------------------------------------------ */}
      <section className="rounded-card border border-line bg-surface p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-md font-bold text-ink">ملاحظات</h2>
          <span className="tabular text-xs text-muted" dir="ltr">
            {notes.length}
          </span>
        </div>

        {open === 'new' || typeof open === 'number' ? (
          <Editor
            draft={draft}
            busy={busy}
            isNew={open === 'new'}
            onChange={setDraft}
            onSave={save}
            onCancel={close}
          />
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={startNew}
            className="min-h-tap w-full rounded-control bg-gradient-to-br from-gold-hi via-gold to-gold-lo text-sm font-bold text-on-gold disabled:opacity-40"
          >
            ملاحظة جديدة
          </button>
        )}

        {notes.length === 0 ? (
          <p className="py-6 text-center text-sm text-faint">
            لا ملاحظات بعد — اكتب أول ملاحظة
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {notes.map((note) => {
              const title = noteTitle(note.body);
              const preview = notePreview(note.body);
              const at = ksaClockTimeOf(note.updatedAt);

              return (
                <li
                  key={note.id}
                  className="rounded-control border border-line-soft bg-surface-raised"
                >
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => startEdit(note)}
                    className="flex min-h-tap w-full flex-col items-stretch gap-0.5 px-3 py-2 text-right disabled:opacity-40"
                  >
                    <span className="truncate text-sm font-bold text-ink">
                      {title === '' ? '(بدون عنوان)' : title}
                    </span>
                    {preview !== '' && (
                      <span className="truncate text-xs text-muted">{preview}</span>
                    )}
                  </button>

                  <div className="flex items-center justify-between gap-2 border-t border-line-soft px-3 py-1">
                    <span className="tabular text-xs text-faint" dir="ltr">
                      {at ?? ''}
                    </span>

                    {confirming === note.id ? (
                      <span className="flex items-center gap-1">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            onRemove(note.id);
                            setConfirming(null);
                          }}
                          className="min-h-tap rounded-control px-3 text-xs font-bold text-behind disabled:opacity-40"
                        >
                          تأكيد الحذف
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirming(null)}
                          className="min-h-tap rounded-control px-3 text-xs text-muted"
                        >
                          إلغاء
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setConfirming(note.id)}
                        aria-label={`حذف ${title === '' ? 'الملاحظة' : title}`}
                        className="min-h-tap w-9 text-behind disabled:opacity-40"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* --- Reminders, moved here from the Admin tab ------------------- */}
      {tasks !== undefined && (
        <section className="rounded-card border border-line bg-surface p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-md font-bold text-ink">متابعاتي</h2>
            <span className="tabular text-xs text-muted" dir="ltr">
              {tasks.tasks.filter((task) => !task.done).length}
            </span>
          </div>
          <TasksSection {...tasks} />
        </section>
      )}
    </div>
  );
}

function Editor({
  draft,
  busy,
  isNew,
  onChange,
  onSave,
  onCancel,
}: {
  draft: string;
  busy: boolean;
  isNew: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const remaining = MAX_NOTE_LENGTH - draft.length;

  return (
    <div>
      <label htmlFor="note-body" className="mb-1.5 block text-xs text-muted">
        {isNew ? 'ملاحظة جديدة' : 'تعديل الملاحظة'}
      </label>
      <textarea
        id="note-body"
        value={draft}
        rows={6}
        maxLength={MAX_NOTE_LENGTH}
        onChange={(event) => onChange(event.target.value)}
        placeholder={'السطر الأول يظهر كعنوان\nوالباقي تفاصيل'}
        className="w-full resize-y rounded-control border border-line-soft bg-surface-raised px-3 py-2 text-sm leading-relaxed text-ink"
      />

      {/* Only worth showing as the cap gets close; a counter on an empty note
          is noise. */}
      {remaining < 500 && (
        <p className="tabular mt-1 text-xs text-faint" dir="ltr">
          {remaining}
        </p>
      )}

      <div className="mt-2 grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={busy || draft.trim() === ''}
          onClick={onSave}
          className="min-h-tap rounded-control bg-gradient-to-br from-gold-hi via-gold to-gold-lo text-sm font-bold text-on-gold disabled:opacity-40"
        >
          حفظ
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          className="min-h-tap rounded-control border border-line text-sm text-muted disabled:opacity-40"
        >
          إلغاء
        </button>
      </div>
    </div>
  );
}
