/**
 * The supervisor's private reminders (`sup_tasks`).
 *
 * Owner-scoped by RLS: only the person who created a task can read or write it.
 * Every query here also filters on `owner_id` explicitly — RLS is the boundary,
 * but a query that relies on it silently returns nothing when it drifts, and a
 * silently empty task list looks like a completed one.
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
  };
}

/** Outstanding first, then grouped by kind — the order the supervisor works in. */
export async function listTasks(ownerId: string): Promise<Result<SupTask[]>> {
  const { data, error } = await db
    .from('sup_tasks')
    .select(TASK_COLUMNS)
    .eq('owner_id', ownerId)
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

export async function setTaskDone(
  taskId: number,
  ownerId: string,
  done: boolean,
): Promise<Result<true>> {
  const { error } = await db
    .from('sup_tasks')
    .update({ done })
    .eq('id', taskId)
    .eq('owner_id', ownerId);

  if (error) return failFrom(error, { action: 'تحديث المهمة' });
  return ok(true);
}

export async function removeTask(taskId: number, ownerId: string): Promise<Result<true>> {
  const { error } = await db
    .from('sup_tasks')
    .delete()
    .eq('id', taskId)
    .eq('owner_id', ownerId);

  if (error) return failFrom(error, { action: 'حذف المهمة' });
  return ok(true);
}

/** Clears every tick. Manual by design — see the note at the top of this file. */
export async function resetTasks(ownerId: string): Promise<Result<true>> {
  const { error } = await db
    .from('sup_tasks')
    .update({ done: false })
    .eq('owner_id', ownerId)
    .eq('done', true);

  if (error) return failFrom(error, { action: 'إعادة تعيين المهام' });
  return ok(true);
}

/** True when a `once` task is due today or overdue. */
export function isOverdue(task: SupTask, today: BusinessDate): boolean {
  return task.kind === 'once' && !task.done && task.dueDate !== null && task.dueDate <= today;
}
