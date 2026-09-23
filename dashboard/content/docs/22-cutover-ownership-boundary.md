# 22 — Cutover: the ownership boundary

## What it is (plain language)

Today almost every row in the CRM tables was copied in from Dynamics. The plan is for the dashboard to start **creating its own records** in those same tables, and eventually to replace Dynamics as the CRM.

Before the dashboard writes a single row, the Dynamics sync has to be unable to damage those rows. The **ownership boundary** (or "fence") does that: each row is labelled with **who owns it**, and the sync machinery only touches rows that came from Dynamics.

> **This fence is the prerequisite for any dashboard write.** It adds no "Add new" button and writes no records itself. It only makes future dashboard writes safe.

Why it's needed: the nightly **deletion sweep** flags any row it can't find in Dynamics as "deleted in Dynamics". A dashboard-created row is *never* in Dynamics, so without the fence every dashboard row would appear on **Admin → Reconciliation** every night, and one "Approve" would permanently delete it.

---

## The two new columns

Added to the 8 tables the dashboard will write to: **accounts, contacts, meetings, tasks, touchpoints, client_notes, events, contracts**.

| Column | Values | Default | Meaning |
|---|---|---|---|
| `origin` | `'dynamics'` \| `'dashboard'` | `'dynamics'` | Who owns the row. Every existing row, and every row the sync inserts, is `'dynamics'`. Dashboard writes must set `'dashboard'` explicitly. |
| `is_test` | `true` \| `false` | `false` | Test data, separate from ownership. Lets test records be marked from the very first dashboard write. Views don't filter on it yet. |

Not on `users` or `new_vacationrequest`. The dashboard doesn't write those, so they have no fence (see `hasOrigin` below).

## What the fence does

1. **The sync never sets `origin`.** The mappers (`lib/sync/mappers.ts`) are unchanged. A sync insert gets the `'dynamics'` default, and a sync update leaves `origin` alone.
2. **Origin is locked.** A `BEFORE UPDATE` trigger (`<table>_lock_origin` → `public.lock_origin()`) forces `NEW.origin := OLD.origin`. No update can change a row's owner, including a sync upsert on a colliding id (which is vanishingly unlikely anyway, since dashboard ids are random `gen_random_uuid()` values).
3. **`_synced_at` skips dashboard rows.** The shared `touch_synced_at()` trigger function now stamps `_synced_at` only when the row is **not** `'dashboard'`. A dashboard row keeps the value it was inserted with, and "last synced" is never claimed for a row Dynamics never sent. Dashboard writes should track their own edit time in `modified_on`. The function reads origin via `to_jsonb(NEW)->>'origin'`, so tables without the column (`new_vacationrequest`) behave exactly as before.
4. **The deletion sweep ignores dashboard rows.** `lib/sync/reconcile.ts` `fetchMirrorPks` reads only `origin = 'dynamics'` keys for entities with `hasOrigin`, so dashboard rows are never flagged.
5. **Approve-delete refuses dashboard rows.** `app/admin/reconciliation/actions.ts` `deleteOne` (used by both single and bulk approve) adds `origin = 'dynamics'` to the delete. If nothing is removed, the candidate is **not** marked deleted. The admin gets "Not deleted: no Dynamics-origin row…", a warning is logged, and the candidate stays pending to be cleared with **Keep**.

### `hasOrigin` vs `skipDeletionSweep`

Both live on `EntityConfig` in `lib/sync/entities.ts`:

- **`skipDeletionSweep`** is **table-level**: the entity is never swept at all (contacts today).
- **`hasOrigin`** is **row-level**: the entity is still swept for its Dynamics rows, and its dashboard rows are excluded. It must be `true` exactly on the tables that have the `origin` column. Setting it on a table without the column makes that entity's sweep error and skip.

---

## Technical

| Piece | Where |
|---|---|
| Columns, lock trigger, `touch_synced_at()` change, check queries | `sql/patches/2026-09-23_origin_ownership_fence.sql` |
| `hasOrigin` flag (8 entities) | `lib/sync/entities.ts` |
| Sweep filter | `lib/sync/reconcile.ts` → `fetchMirrorPks` |
| Delete guard | `app/admin/reconciliation/actions.ts` → `deleteOne` |

**Rollout order.** The SQL must run **before** the code ships, because the code filters on a column that must already exist.

1. Run the SQL patch in Supabase.
2. Run the patch's "Check it" queries. Every table should be 100% `origin='dynamics'`, `is_test=false`, and there should be 8 `_lock_origin` triggers.
3. Deploy the code (sweep filter + delete guard).
4. Run the patch's third check query once: the reconciliation queue has no pending candidate pointing at a dashboard row.

**Gotchas**

- **Re-running old SQL reverts the `_synced_at` change.** `touch_synced_at()` is also defined in `sql/01_mirror_tables.sql` and `sql/patches/2026-09-09_feedback_received_and_synced_at.sql`. Re-running either restores the old body, so re-run Part C of the fence patch afterwards.
- **Trigger order matters.** Postgres fires same-timing triggers in name order, so `_lock_origin` runs before `_touch_synced_at`, and the synced-at check sees the locked origin.
- **Changing a row's owner on purpose** (e.g. "adopting" a Dynamics row at cutover) is blocked by the lock trigger. It needs an explicit, audited migration that disables the trigger for that statement.
- **Dashboard inserts will still need:** a fresh `gen_random_uuid()` pk, `origin='dashboard'`, `_raw` (`'{}'` for contacts, where it is `NOT NULL`), valid `users(user_id)` foreign keys, and a `recordAudit` call ([18 — Audit Trail](18-audit-trail.md)). Many views pull fields out of `_raw`, so dashboard rows will show blanks there until those views read flattened columns.
- **Contacts has no DELETE grant.** It isn't swept today, but a future dashboard delete of a contact needs one.
