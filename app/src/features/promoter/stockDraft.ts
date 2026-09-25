/**
 * The stock form: what the promoter has typed, laid over what is saved.
 *
 * Only edits are held in state; saved counts are read on every render. The
 * first version copied the saved counts into state once, when the tab mounted —
 * but the tab mounts before those counts have loaded, so the copy was empty.
 * The first visit to the tab showed every box blank under a line saying items
 * were already saved, and a message generated from there left out everything
 * the promoter did not retype.
 *
 * A cleared box is an edit too, recorded as `''`. Dropping the edit instead
 * would bring the saved number straight back into the box being emptied.
 */

/** The value each box shows, by item id. */
export function stockDraft(
  saved: ReadonlyMap<number, number>,
  edits: ReadonlyMap<number, string>,
): ReadonlyMap<number, string> {
  const draft = new Map<number, string>();
  for (const [id, quantity] of saved) draft.set(id, String(quantity));
  for (const [id, raw] of edits) draft.set(id, raw);
  return draft;
}

/** The counts worth saving: non-empty, whole, not negative. */
export function quantitiesOf(draft: ReadonlyMap<number, string>): ReadonlyMap<number, number> {
  const quantities = new Map<number, number>();
  for (const [id, raw] of draft) {
    if (raw.trim() === '') continue;
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed >= 0) quantities.set(id, parsed);
  }
  return quantities;
}
