/**
 * Notes (`notes`). Free text, private to whoever wrote it.
 *
 * Deliberately the plainest module in `data/`. A note has one field, and the
 * only ordering that matters is most-recently-touched first — which is what a
 * person expects when they reopen a notes list.
 *
 * Two things are not obvious:
 *
 * `updated_at` is never sent from here. A trigger sets it server-side, because
 * a device with a wrong clock would otherwise reorder the list for everyone
 * using that account. The same reasoning as `created_at` on a sale.
 *
 * The body is cleaned, not collapsed. Outlet fields use `oneLine` because they
 * are single-line by definition; a note is the opposite — line breaks are the
 * whole point. So the cleaning here normalises and bounds rather than flattens.
 */

import { db } from '../lib/supabase';
import { failFrom, invalid, ok, type Result } from './errors';

const NOTE_COLUMNS = 'id, body, created_at, updated_at';

/** Matches the `notes_body_len` check constraint. */
export const MAX_NOTE_LENGTH = 5000;

export interface Note {
  readonly id: number;
  readonly body: string;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
}

type Row = Record<string, unknown>;

export function parseNote(row: unknown): Note | null {
  if (row === null || row === undefined || typeof row !== 'object') return null;
  const record = row as Row;

  const id = record['id'];
  const body = record['body'];
  if (typeof id !== 'number') return null;
  if (typeof body !== 'string') return null;

  const createdAt = record['created_at'];
  const updatedAt = record['updated_at'];

  return {
    id,
    body,
    createdAt: typeof createdAt === 'string' ? createdAt : null,
    updatedAt: typeof updatedAt === 'string' ? updatedAt : null,
  };
}

// ---------------------------------------------------------------------------
// Pure text handling — no database, so it is testable on its own
// ---------------------------------------------------------------------------

/**
 * Normalises a note before it is stored.
 *
 * Windows line endings become `\n` so the same note does not render with
 * different spacing depending on which device wrote it. Runs of blank lines
 * collapse to one, which stops a paste from a chat app arriving as a page of
 * whitespace. Trailing spaces go; internal ones stay, because someone may be
 * lining something up deliberately.
 */
export function cleanNoteBody(input: string): string {
  return input
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_NOTE_LENGTH);
}

/**
 * The first line, used as the note's heading in the list.
 *
 * Derived rather than stored: asking for a title up front is a decision at
 * exactly the moment someone is trying to get a thought down quickly.
 */
export function noteTitle(body: string): string {
  const first = body.split('\n').find((line) => line.trim() !== '');
  return first === undefined ? '' : first.trim();
}

/** Everything after the heading, for the preview line. */
export function notePreview(body: string): string {
  const lines = body.split('\n');
  const firstIndex = lines.findIndex((line) => line.trim() !== '');
  if (firstIndex === -1) return '';
  return lines
    .slice(firstIndex + 1)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Rejects an empty note before it reaches the check constraint. */
export function validateNote(body: string): string | null {
  if (cleanNoteBody(body) === '') return 'اكتب شيئاً أولاً';
  return null;
}

// ---------------------------------------------------------------------------
// Queries — every one filters on owner_id explicitly
// ---------------------------------------------------------------------------

/** What a PostgREST call resolves to, narrowed to what this file reads. */
interface NoteResult {
  data: unknown;
  error: { code?: string | null; message?: string | null } | null;
}

/**
 * The slice of the query builder used below, without table typing.
 *
 * `notes` does not exist in `types/database.ts` until migration 002 is applied
 * and `npm run gen:types` re-runs, so the compiler cannot see a table that is
 * real in the database. Confining that to one helper means removing it later
 * is a one-line change rather than unpicking `as never` from five call sites.
 *
 * Nothing is lost by it: the compiler never validated these rows anyway. Every
 * row that comes back goes through {@link parseNote}, which rejects anything
 * whose shape is wrong — that is where the safety actually lives.
 */
interface NoteQuery extends PromiseLike<NoteResult> {
  select(columns: string): NoteQuery;
  insert(row: Record<string, unknown>): NoteQuery;
  update(row: Record<string, unknown>): NoteQuery;
  delete(): NoteQuery;
  eq(column: string, value: unknown): NoteQuery;
  order(column: string, options: { ascending: boolean }): NoteQuery;
  single(): PromiseLike<NoteResult>;
}

const notes = (): NoteQuery =>
  (db as unknown as { from(table: string): NoteQuery }).from('notes');

/**
 * One person's notes, most recently changed first.
 *
 * The `owner_id` filter is redundant against RLS and kept anyway: a query that
 * leans on RLS alone returns nothing when a policy drifts, and an empty notes
 * list looks like someone who has not written anything rather than a fault.
 */
export async function listNotes(ownerId: string): Promise<Result<Note[]>> {
  const { data, error } = await notes()
    .select(NOTE_COLUMNS)
    .eq('owner_id', ownerId)
    .order('updated_at', { ascending: false });

  if (error) return failFrom(error, { action: 'قراءة الملاحظات' });
  // `data` is `unknown` by construction — see the note on NoteQuery. Anything
  // that is not an array of parseable rows becomes an empty list rather than a
  // crash, which is the same posture every other parser here takes.
  const rows = Array.isArray(data) ? data : [];
  return ok(rows.map(parseNote).filter((note): note is Note => note !== null));
}

export async function createNote(ownerId: string, body: string): Promise<Result<Note>> {
  const problem = validateNote(body);
  if (problem !== null) return invalid(problem);

  const { data, error } = await notes()
    .insert({ owner_id: ownerId, body: cleanNoteBody(body) })
    .select(NOTE_COLUMNS)
    .single();

  if (error) return failFrom(error, { action: 'حفظ الملاحظة' });

  const parsed = parseNote(data);
  return parsed === null
    ? invalid('حُفظت الملاحظة لكن تعذّرت قراءتها — حدّث الصفحة')
    : ok(parsed);
}

/** Rewrites a note's body. `updated_at` moves on its own, server-side. */
export async function updateNote(
  noteId: number,
  ownerId: string,
  body: string,
): Promise<Result<Note>> {
  const problem = validateNote(body);
  if (problem !== null) return invalid(problem);

  const { data, error } = await notes()
    .update({ body: cleanNoteBody(body) })
    .eq('id', noteId)
    .eq('owner_id', ownerId)
    .select(NOTE_COLUMNS)
    .single();

  if (error) return failFrom(error, { action: 'تعديل الملاحظة' });

  const parsed = parseNote(data);
  return parsed === null
    ? invalid('حُفظ التعديل لكن تعذّرت قراءته — حدّث الصفحة')
    : ok(parsed);
}

export async function removeNote(noteId: number, ownerId: string): Promise<Result<true>> {
  const { error } = await notes()
    .delete()
    .eq('id', noteId)
    .eq('owner_id', ownerId);

  if (error) return failFrom(error, { action: 'حذف الملاحظة' });
  return ok(true);
}
