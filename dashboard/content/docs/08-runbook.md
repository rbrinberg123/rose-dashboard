# 08 — Runbook

Practical, step-by-step procedures. Most require **super-user** access and/or the Supabase project.

---

## Run a manual sync

**From the app (easiest):** go to **Admin → Sync status** (`/admin/sync`) and click **Run sync now**. This POSTs to `/api/sync-dynamics` via a server action that adds the `CRON_SECRET` bearer header for you. The per-entity table and error list refresh when it finishes.

**From the command line** (needs the secret):

```bash
curl -X POST https://<your-vercel-domain>/api/sync-dynamics \
  -H "Authorization: Bearer $CRON_SECRET"
```

A 207 response means the sync finished but at least one entity errored — check `/admin/sync` or the `sync_errors` table.

The **reconciliation** sweep works the same way at `/admin/reconciliation` and `/api/reconcile-dynamics`.

---

## Apply view / table DDL in Supabase

SQL files do **not** auto-apply (see [00 — Architecture](00-architecture.md)). To deploy a change:

1. Open the **Supabase SQL editor** for the project (`https://supabase.com/dashboard/project/uegfmuvkavexmxxaxnwe`).
2. Paste the file you changed (e.g. `sql/03_views.sql`) and **Run**. The view files use `create or replace`, so they're safe to re-run.
3. For a **new column on an already-deployed table**, run the matching `sql/patches/<date>_*.sql` (an `ALTER TABLE`) — a `create table if not exists` will **not** alter an existing table.
4. Sanity-check: `SELECT * FROM v_<name> LIMIT 5;`. If the app's live "Views" panel (Admin → Docs) now lists it, it deployed.

---

## Backfill a newly-modeled field from `_raw`

Every mirrored row keeps its full Dynamics payload in `_raw` (except `users`). Two options:

**A. Read on demand** — no backfill needed:

```sql
SELECT account_id, _raw->>'bcs_somefield' AS some_field FROM accounts;
```

**B. Populate the new column for history** (after you've added the column):

```sql
UPDATE accounts SET some_field = _raw->>'bcs_somefield' WHERE some_field IS NULL;
```

**C. Force a full re-pull** (re-fetch every row from Dynamics, re-running the mapper so new columns fill in) by clearing the entity's watermark, then run a sync:

```sql
UPDATE sync_runs SET last_synced_at = NULL WHERE entity_name = 'accounts';
-- then: Admin → Sync → Run sync now
```

A cleared watermark makes the next run a **full pull** for that entity (see [05 — Sync & Integrations](05-sync-and-integrations.md)).

---

## Handle a CRM deletion (a record removed in Dynamics)

The sync never deletes; the nightly **reconciliation** sweep detects it:

1. The sweep finds the mirror row whose PK is no longer in Dynamics and files it in `deletion_candidates` (status `pending`).
2. It appears in **Admin → Reconciliation** (`/admin/reconciliation`) with a human-readable label.
3. A super-user reviews and either **approves** (deletes the mirror row) or **dismisses** (keeps it — e.g. a Dynamics record that was legitimately re-created).
4. If the record reappears in Dynamics before you act, the sweep **auto-removes** it from the queue.

The safety guard: if Dynamics returned zero IDs for an entity (a likely outage), that entity is **skipped**, never mass-flagged.

---

## Recover a wrongly-deleted mirror row

If a mirror row was approved for deletion by mistake **but the record still exists in Dynamics**:

1. **Preferred:** force a full re-pull for that entity (clear its `sync_runs.last_synced_at`, then run a sync — see the backfill recipe above). The upsert re-adds every live Dynamics record, including the one removed.
2. The `deletion_candidates.raw_snapshot` for that row also holds a copy of its data (minus `_raw`) if you need to inspect what was removed.

If the record was **also** deleted in Dynamics and you need it back, restore it in Dynamics first; the next sync mirrors it again.

---

## "Something looks wrong" — where to check

| Symptom | First place to look |
|---------|--------------------|
| Data looks stale everywhere | **Admin hub** (`/admin`) → Sync tile freshness; is the newest run > 25h old? Then `/admin/sync`. |
| One entity is stale or erroring | `/admin/sync` per-entity table + recent errors; `sync_errors` in `/admin/database`. |
| A page shows a wrong number | Find its view in [04 — Views](04-views.md), run it in Supabase, check the rule; verify the source data in `meetings`/`accounts`. |
| A view returns 0 rows unexpectedly | `/admin/database` "Key views" panel flags 0-row views; check the view's `WHERE` filters (Active? Confirmed? date window?). |
| A record vanished | `/admin/reconciliation` — was it flagged as a deletion candidate? |
| An email didn't send | `cron_send_log` (was the day claimed?), the route's Eastern-window gate, and the Vercel function logs. See [06 — Automations](06-automations.md). |
| A field is blank that shouldn't be | Is it modeled as a column, or only in `_raw`? Was it populated in Dynamics? Backfill recipe above. |
| Access denied / wrong pages visible | `user_roles` table + [01 — Access & Users](01-access-and-users.md). |

External dashboards (Vercel logs, Supabase logs, Dynamics) are linked from the **Admin hub** (`/admin`).
