/**
 * The mandatory daily checklist.
 *
 * Responses are keyed by (item, promoter, work_date) rather than by attendance
 * session, so they follow the business day rather than a shift. A promoter
 * working both shifts of a dual outlet ticks the list once, not twice.
 */

import { db } from '../lib/supabase';
import type { BusinessDate } from '../lib/businessDay';
import { oneLine } from '../domain/text';
import { failFrom, ok, type Result } from './errors';

const ITEM_COLUMNS = 'id, title, active, sort_order';
const RESPONSE_COLUMNS = 'id, item_id, promoter_id, work_date, checked';

export interface ChecklistItem {
  readonly id: number;
  readonly title: string;
  readonly sortOrder: number;
}

type Row = Record<string, unknown>;

export function parseChecklistItem(row: unknown): ChecklistItem | null {
  if (row === null || row === undefined || typeof row !== 'object') return null;
  const record = row as Row;

  const id = record['id'];
  const rawTitle = record['title'];
  if (typeof id !== 'number') return null;
  if (typeof rawTitle !== 'string' || rawTitle.trim() === '') return null;

  const sortOrder = record['sort_order'];
  return {
    id,
    // Titles are supervisor-authored free text and render into the UI.
    title: oneLine(rawTitle, 160),
    sortOrder: typeof sortOrder === 'number' ? sortOrder : 0,
  };
}

/** Active items in display order. */
export async function listItems(): Promise<Result<ChecklistItem[]>> {
  const { data, error } = await db
    .from('checklist_items')
    .select(ITEM_COLUMNS)
    .eq('active', true)
    .order('sort_order');

  if (error) return failFrom(error, { action: 'قراءة بنود التشيك' });
  return ok((data ?? []).map(parseChecklistItem).filter((i): i is ChecklistItem => i !== null));
}

/** The item ids this promoter has ticked for the given business day. */
export async function checkedOn(
  promoterId: string,
  workDate: BusinessDate,
): Promise<Result<ReadonlySet<number>>> {
  const { data, error } = await db
    .from('checklist_responses')
    .select(RESPONSE_COLUMNS)
    .eq('promoter_id', promoterId)
    .eq('work_date', workDate);

  if (error) return failFrom(error, { action: 'قراءة التشيك ليست' });

  const done = new Set<number>();
  for (const row of data ?? []) {
    const record = row as Row;
    const itemId = record['item_id'];
    if (record['checked'] === true && typeof itemId === 'number') done.add(itemId);
  }
  return ok(done);
}

/** Ticks or unticks one item for one business day. */
export async function setChecked(
  itemId: number,
  promoterId: string,
  workDate: BusinessDate,
  checked: boolean,
): Promise<Result<true>> {
  const { error } = await db
    .from('checklist_responses')
    .upsert(
      { item_id: itemId, promoter_id: promoterId, work_date: workDate, checked },
      { onConflict: 'item_id,promoter_id,work_date' },
    );

  if (error) return failFrom(error, { action: 'حفظ التشيك' });
  return ok(true);
}
