# Migrations

Numbered, additive, applied by hand. There is no migration runner — the owner
pastes each file into the Supabase SQL Editor, in order.

## Rules

**Additive only.** Add columns, add indexes, add constraints that no existing row
violates. Never drop or rename a column that the running app reads: the legacy
app and the rebuild are both live, and neither can be updated atomically with
the database.

**Every file carries its own rollback and its own verification.** The rollback
goes at the bottom, commented out. The verification says what result to expect,
not just what to run — "expect 2 rows" is checkable, "check the indexes" is not.

**Deploy in expand order, roll back in contract order.**

```
apply:     database  →  regenerate types  →  client
roll back: client    →  database
```

Both apps talk to one database, so the database must accept the old and the new
client at the same time for the whole window between those steps. That is what
makes "additive only" a hard rule rather than a preference: a column the new
client writes has to be invisible to the old one, and a column the old client
writes has to keep working.

Regenerating types is not optional between the two steps — the client references
columns the generated types will not know about until it runs:

```bash
npm run gen:types
```

**Write the client so the order is a preference, not a dependency.** The app
deploys itself on merge while these files are applied by hand, so the two cannot
be sequenced reliably, and a client that hard-fails against a schema it is
half a step ahead of will take the app down. A new column should be attempted
and abandoned on `PGRST204` rather than assumed — see `insertIdempotently` in
[`app/src/data/idempotency.ts`](../../app/src/data/idempotency.ts) for the shape
that does this. The ordering above then buys efficiency, and getting it wrong
costs a wasted round trip instead of a broken shift.

## Applying one

1. Open the Supabase SQL Editor for project `lgewtvrqfofnkrfzqqlz`.
2. Paste the whole file — everything above the `VERIFICATION` banner is the
   migration, and it is wrapped in `begin` / `commit`.
3. Run the verification queries from the same file and compare against the
   stated expectations.
4. Only then regenerate types and deploy.

Re-running a file is safe. Each one guards its own statements with
`if not exists`, so a partial application can be finished by running it again.

## Index

| # | File | What it adds | Applied |
|---|---|---|---|
| 001 | [`001_client_op_id.sql`](001_client_op_id.sql) | `client_op_id` on `attendance` and `sell_operations`, plus partial unique indexes, so a retried offline write cannot duplicate | not yet |

Update the `Applied` column when a migration goes in. A migration that exists in
this folder but has not been run is the most dangerous state in the project — it
means the client and the schema disagree and nobody has written down which way.
