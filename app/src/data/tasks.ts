/**
 * The shared reminders list (`sup_tasks`).
 *
 * Was private to whoever wrote a row. Migration 003 widened RLS so the
 * supervisor and the manager read and write one list, which is how work gets
 * passed between them without leaving the app.
 *
 * `owner_id` survives that change and still records who created a row — the UI
 * shows it, so "call the supplier" has a face attached. It no longer restricts
 * who may read or tick a task: either of them can close any item, because a
 * shared list where only the author can tick things is not shared.
 *
 * There is no auto-rollover. A daily task stays ticked until the supervisor
 * resets it, which is deliberate: an automatic reset overnight would erase the
 * record of whether yesterday actually got done.
 */

import { db } from '../lib/supabase';
import type { BusinessDate } from '../lib/businessDay';
import { oneLine } from '../domain/text';
import { TaskKind, type TaskKind as TaskKindValue } from '../domain/values';
import { failFrom, invalid, ok, type Result } from './errors';

const TASK_COLUMNS = 'id, owner_id, title, kind, weekday, due_date, done';

export interface SupTask {
  readonly id: number;
  /** Who wrote it. Shown so the other person knows where an item came from. */
  readonly ownerId: string;
  readonly title: string;
  readonly kind: TaskKindValue;
  /** 0-6, Sunday first. Only meaningful for `weekly`. */
  readonly weekday: number | null;
  /** Only meaningful for `once`. */
  readonly dueDate: BusinessDate | null;
  readonly done: boolean;
}

type Row = Record<string, unknown>;

export function parseTask(row: unknown): SupTask | null {
  if (row === null || row === undefined || typeof row !== 'object') return null;
  const record = row as Row;

  const id = record['id'];
  const rawTitle = record['title'];
  const kind = TaskKind.tryParse(record['kind']);
  if (typeof id !== 'number') return null;
  if (typeof rawTitle !== 'string' || rawTitle.trim() === '') return null;
  if (kind === null) return null;

  const weekday = record['weekday'];
  const dueDate = record['due_date'];

  return {
    id,
    title: oneLine(rawTitle, 160),
    kind,
    weekday:
      typeof weekday === 'number' && weekday >= 0 && weekday <= 6 ? weekday : null,
    dueDate: typeof dueDate === 'string' && dueDate !== '' ? dueDate : null,
    done: record['done'] === true,
    ownerId: typeof record['owner_id'] === 'string' ? (record['owner_id'] as string) : '',
  };
}

/**
 * Outstanding first, then grouped by kind — the order the list is worked in.
 *
 * No owner filter: the list is shared, so scoping it would hide exactly the
 * items the other person added.
 */
export async function listTasks(): Promise<Result<SupTask[]>> {
  const { data, error } = await db
    .from('sup_tasks')
    .select(TASK_COLUMNS)
    .order('done')
    .order('kind')
    .order('id');

  if (error) return failFrom(error, { action: 'قراءة المهام' });
  return ok((data ?? []).map(parseTask).filter((t): t is SupTask => t !== null));
}

export interface NewTask {
  readonly title: string;
  readonly kind: TaskKindValue;
  readonly weekday: number | null;
  readonly dueDate: BusinessDate | null;
}

export async function addTask(ownerId: string, task: NewTask): Promise<Result<SupTask>> {
  const title = oneLine(task.title, 160);
  if (title === '') return invalid('اكتب المهمة أولاً');

  const row: {
    owner_id: string;
    title: string;
    kind: string;
    weekday?: number;
    due_date?: string;
  } = { owner_id: ownerId, title, kind: task.kind };

  // Only attach the field the kind actually uses, so a weekly task cannot
  // carry a stale due date from an earlier draft.
  if (task.kind === 'weekly' && task.weekday !== null) row.weekday = task.weekday;
  if (task.kind === 'once' && task.dueDate !== null) row.due_date = task.dueDate;

  const { data, error } = await db.from('sup_tasks').insert(row).select(TASK_COLUMNS).single();

  if (error) {
    return failFrom(error, {
      action: 'إضافة المهمة',
      overrides: { '23514': 'عنوان المهمة مطلوب' },
    });
  }

  const parsed = parseTask(data);
  return parsed === null ? invalid('أُضيفت المهمة لكن تعذّرت قراءتها') : ok(parsed);
}

export async function setTaskDone(taskId: number, done: boolean): Promise<Result<true>> {
  const { error } = await db.from('sup_tasks').update({ done }).eq('id', taskId);

  if (error) return failFrom(error, { action: 'تحديث المهمة' });
  return ok(true);
}

export async function removeTask(taskId: number): Promise<Result<true>> {
  const { error } = await db.from('sup_tasks').delete().eq('id', taskId);

  if (error) return failFrom(error, { action: 'حذف المهمة' });
  return ok(true);
}

/** Clears every tick. Manual by design — see the note at the top of this file. */
export async function resetTasks(): Promise<Result<true>> {
  const { error } = await db
    .from('sup_tasks')
    .update({ done: false })
    .eq('done', true);

  if (error) return failFrom(error, { action: 'إعادة تعيين المهام' });
  return ok(true);
}

/** True when a `once` task is due today or overdue. */
export function isOverdue(task: SupTask, today: BusinessDate): boolean {
  return task.kind === 'once' && !task.done && task.dueDate !== null && task.dueDate <= today;
}
