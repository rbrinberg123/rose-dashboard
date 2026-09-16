# 03 — Data Model

## What it does (plain language)

The database has three kinds of tables:

1. **Mirror tables** — copies of Dynamics. The sync overwrites these; never type into them by hand. (accounts, meetings, contracts, etc.)
2. **Rose-owned tables** — numbers that only exist in the dashboard (costs, salaries, overhead). Entered in the admin pages; the sync never touches them.
3. **Ops tables** — the sync's own bookkeeping (when it last ran, what errored, what got deleted, which emails went out).

On top of these sit the **views** (`v_*`), which are covered in [04 — Views](04-views.md).

One important idea: every mirrored row keeps a **full copy of its original Dynamics record** in a hidden `_raw` column. So even if a Dynamics field isn't modeled as its own column yet, the value is still there — it can be surfaced later without re-syncing.

## Technical

### Mirror tables ↔ Dynamics entities

Defined by the `ENTITIES` array in `dashboard/lib/sync/entities.ts`. Each mirror table is upserted from one Dynamics entity set.

| Mirror table | Dynamics entity set | Dynamics PK field | Local PK column | Mapper |
|--------------|---------------------|-------------------|-----------------|--------|
| `accounts` | `accounts` | `accountid` | `account_id` | `mapAccount` |
| `users` | `systemusers` | `systemuserid` | `user_id` | `mapSystemUser` |
| `meetings` | `bcs_meetings` | `bcs_meetingid` | `meeting_id` | `mapMeeting` |
| `touchpoints` | `phonecalls` | `activityid` | `touchpoint_id` | `mapTouchpoint` |
| `client_notes` | `bcs_clientnotes` | `bcs_clientnoteid` | `note_id` | `mapClientNote` |
| `contracts` | `bcs_contracts` | `bcs_contractid` | `contract_id` | `mapContract` |
| `tasks` | `tasks` | `activityid` | `task_id` | `mapTask` |
| `new_vacationrequest` | `new_vacationrequests` | `new_vacationrequestid` | `ooo_id` | `mapOOO` |
| `events` | `bcs_events` | `bcs_eventid` | `event_id` | `mapEvent` |

Notes:
- `touchpoints` and `tasks` share the Dynamics PK field `activityid` because both are Dataverse **activity** entities.
- The **time-off** mirror table is named `new_vacationrequest` (this is what the sync writes and what `v_time_off` reads). `sql/15_ooo_table.sql` used to create a table named `ooo` instead; **as of 2026-09-09 that file creates `new_vacationrequest`**, so a database rebuilt from `sql/` now gets the table the app actually reads. The `idx_ooo_*` index names are unchanged.
- The DDL for these tables lives at repo root: `sql/01_mirror_tables.sql` (accounts, meetings, touchpoints, client_notes, contracts, users), `sql/14_tasks_table.sql` (tasks), `sql/15_ooo_table.sql` (new_vacationrequest), `sql/16_events_table.sql` (events).

#### DDL ↔ mapper reconciliation (2026-09-09)

The mirror DDL had drifted **behind** the sync mappers: `lib/sync/run.ts` upserts each mapped object straight into its table with no key filtering, so any column a mapper writes must exist live or that entity's rows would all fail. Because the sync runs clean, the live tables were right and only the repo DDL was stale. A sweep of all nine mappers against their `CREATE TABLE` statements found **26 columns** declared nowhere:

| Table | Columns added | What they are |
|-------|---------------|---------------|
| `accounts` | 24 | 10 workflow booleans (`bda_peers`, `calendar`, `calendar_confirmed`, `distro`, `meeting_history_received`, `mgmt_review`, `recurring_call_scheduled`, `report`, `rep_short_interest`, `sh_report`); 6 milestone dates (`last_data_upload`, `onboarding_call`, `original_start_date`, `shareholder_report_received_date`, `teach_in`, `teach_in_date`); 2 lookups as id+name (`current_event_*`, `current_project_*`); 4 free-text (`dietary_restrictions`, `ipreo_ticker`, `onboarding_notes`, `peers`) |
| `meetings` | 2 | `feedback_id` / `feedback_name` — the `bcs_feedback` assignee. This is why `v_feedback_outstanding` and `v_admin_meetings_all` read that person out of `_raw`: the column was not in the DDL when they were written |

The other seven mirror tables (`users`, `touchpoints`, `client_notes`, `contracts`, `tasks`, `new_vacationrequest`, `events`) were already in agreement.

Columns that are declared but **not** written by a mapper are correct and were left alone: `accounts.ai_summary` / `ai_summary_generated_at` are Rose-owned, and `users.first_seen_at` plus every `_synced_at` are DEFAULT-populated (`_synced_at` now also has a trigger — see [`_synced_at`](#_synced_at--last-synced) below). `events.sharepoint_url` looked like one of these but is not — see below.

`sql/patches/2026-09-09_ddl_reconcile.sql` carries the same 26 columns as `ADD COLUMN IF NOT EXISTS` statements. It is a **no-op against production** — those columns already exist there — and is meant for any other environment or a rebuild-from-repo.

**Reverse direction, fully verified (2026-09-09).** All nine mirror tables were fingerprinted against live (`md5(string_agg(column_name, ',' ORDER BY column_name))`, Query 4 in the patch). **Eight matched exactly** — including `accounts`, separately confirmed column-by-column at 85 live vs 85 declared with no orphans either way, the 24 added columns sitting at live positions 62–85 in the order the patch adds them.

**No orphan columns exist** — nothing is live that the repo does not know about.

One table differed, and in the *opposite* direction:

| | repo DDL | live |
|---|---|---|
| `events` | 138 cols · `0e873e73…` | 137 cols · `7422f6e3…` |

The single difference is **`events.sharepoint_url`: the repo declares it, the live database does not have it.** It is not a sync column, so the daily sync never had cause to fail over it.

**What that means today: the Profiles page's SharePoint document link has never been able to work.** `v_profiles_upcoming` selects `e.sharepoint_url AS event_sharepoint_url`, so the live view must still be an older revision — a view cannot be created against a missing column. `app/profiles/page.tsx` reads it with `.select("*")`, so the field returns undefined rather than erroring, and `profiles-view.tsx` renders `row.event_sharepoint_url?.trim()` as a muted placeholder. Nothing is broken; the feature is simply inert.

**Section B** of `sql/patches/2026-09-09_ddl_reconcile.sql` holds the fix — one `ALTER TABLE` plus a re-run of `v_profiles_upcoming` — kept separate from Section A because, unlike the rest of the patch, it **does** change the live database. It is opt-in: the alternative is to drop the column and the view's select, so the repo stops describing a feature that is switched off.

One cosmetic difference the fingerprint deliberately ignores: live `accounts` orders `_synced_at` before `ai_summary`, while the DDL declares it last. Column order is irrelevant for a table (unlike `CREATE OR REPLACE VIEW`), so it was left alone.

### `_synced_at` — last synced

**`_synced_at` is the last time the sync wrote the row.** It is safe to use for freshness: `modified_on > _synced_at` means the record has been edited in Dynamics since the mirror last pulled it.

**That was not true before 2026-09-09.** The column is `DEFAULT now()`, and a DEFAULT fires only on INSERT. No mapper writes `_synced_at`, and the sync upserts only the mapped columns, so `ON CONFLICT DO UPDATE` never touched it — making it an *insert* timestamp. Every row ever edited after its first insert showed `modified_on > _synced_at` **forever**, even when the sync had re-pulled it correctly every ten minutes since. The obvious staleness test flagged every ever-edited row, which is what a reading of "425 stale tasks" actually measured.

A `BEFORE INSERT OR UPDATE` trigger on each of the **eight** mirror tables that have the column now stamps it:

```sql
CREATE OR REPLACE FUNCTION public.touch_synced_at()
RETURNS trigger AS $
BEGIN
  NEW._synced_at = now();
  RETURN NEW;
END;
$ LANGUAGE plpgsql;
```

A trigger rather than nine mapper edits: uniform, automatic, and it cannot be forgotten when a tenth entity is added. `BEFORE INSERT` as well as UPDATE so the column has exactly one writer; on insert it sets the same value the DEFAULT would have.

**Caveat when reading the numbers:** rows keep their old insert-time stamp until their *next* sync, so a "stale" count will look unchanged at first and drain as records are re-pulled. To reset the baseline in one go, force a full re-pull for the entity (see [08 — Runbook](08-runbook.md)) and run a sync.

#### ⚠️ `public.users` must NOT have this trigger

**`public.users` is the one mirror table with no `_synced_at` column.** It tracks freshness with `first_seen_at` / `last_seen_at` instead, and `mapSystemUser` writes `last_seen_at` directly on every run. It also has no `_raw`. It is not shaped like the other mirrors.

The 2026-09-09 patch attached the trigger to `users` anyway. Because a plpgsql trigger referencing a non-existent field fails at **runtime**, not at `CREATE TRIGGER` time, nothing complained until the next sync — and then **every** `users` upsert threw:

```
record "new" has no field "_synced_at"
```

The systemusers sync failed on every run from 2026-09-11 to 2026-09-16. No new or changed Dynamics user mirrored in for five days, so they could not be granted roles or appear anywhere in permissions (`jfoley@roseandco.com` was the record that surfaced it). Worse, the watermark still advanced — `syncEntity` treats per-batch upsert failures as `partial` and writes `last_synced_at` anyway (`lib/sync/run.ts`) — so the missed users were **not** picked up automatically once the trigger was dropped. They needed a forced full re-pull:

```sql
UPDATE public.sync_runs SET last_synced_at = NULL WHERE entity_name = 'systemusers';
```

**Rule: when adding a mirror table, attach `touch_synced_at` only if the table actually declares `_synced_at`.** This query lists every attachment and whether the column exists — every row should read `true`:

```sql
SELECT c.relname AS table_name,
       EXISTS (
         SELECT 1 FROM information_schema.columns col
          WHERE col.table_schema = 'public'
            AND col.table_name   = c.relname
            AND col.column_name  = '_synced_at'
       ) AS has_column
  FROM pg_trigger t
  JOIN pg_class   c ON c.oid = t.tgrelid
 WHERE NOT t.tgisinternal
   AND t.tgfoid = 'public.touch_synced_at'::regproc
 ORDER BY c.relname;
```

Applied by `sql/patches/2026-09-09_feedback_received_and_synced_at.sql`; the `users` trigger removed by `sql/patches/2026-09-16_drop_users_synced_at_trigger.sql`.

### The `_raw` JSONB pattern

Every mapper **except `mapSystemUser`** writes the entire source Dynamics record into a `_raw jsonb` column:

```ts
// dashboard/lib/sync/mappers.ts — e.g. mapAccount
return {
  account_id: ...,
  // ...modeled columns...
  _raw: row,        // full Dynamics payload, verbatim
}
```

Present on: `accounts`, `meetings`, `touchpoints`, `client_notes`, `contracts`, `tasks`, `new_vacationrequest`, `events`. The `users` table has **no** `_raw` column (its mapper writes only a curated set).

Why it matters: a Dynamics field that isn't its own column can still be read with `table._raw->>'bcs_fieldname'`. Several views already do this — e.g. `v_live_outreach` reads `accounts._raw->>'bcs_divyield'`, and `v_feedback_outstanding` reads `_raw->>'_bcs_feedback_value'`. See the "backfill from `_raw`" recipe in [08 — Runbook](08-runbook.md).

### Column conventions (set by the mappers)

- **Choice / option-set** fields become a pair: `{field}_code` (the numeric code) + `{field}_label` (the display text).
- **Lookups** (references to another record) become a pair: `{field}_id` (the GUID) + `{field}_name` (the resolved display name).
- **Money** uses `num()`; contracts also mirror the Dynamics `_base` companion (e.g. `quarterly_retainer_base`).
- **Multi-select** picklists are stored as two comma-separated text columns (`{field}_codes` / `{field}_labels`).
- `meetings.is_in_person` is a derived boolean (`true` = the meeting-type label is "Live"). This is the firm's live-vs-virtual switch — see [07 — Business Rules](07-business-rules.md).
- `meetings.hosted_in_hq` mirrors Dynamics `bcs_HostedinHQ` (Yes/No) — `true` when the client is hosted in the HQ / office that day. It is the authoritative "in the office" flag for the Week Ahead email digest (banner + week-grid pins). Added 2026-07-29 via `sql/patches/2026-07-29_meeting_hosted_in_hq.sql` (ADD COLUMN + `_raw` backfill).

Full field-type helper reference is in [05 — Sync & Integrations](05-sync-and-integrations.md).

### Rose-owned tables (never synced)

Admin-entered, defined in `sql/02_rose_owned_tables.sql`. The sync never writes them.

| Table | Purpose | Entered via |
|-------|---------|-------------|
| `cost_assumptions` | Hours-per-meeting, in-person multiplier, etc. (single config row) | `/cost-assumptions` |
| `salary_schedule` | Per-person salary over effective-date windows | `/salary-schedule` |
| `client_direct_costs` | T&E and event costs per client | `/direct-costs` |
| `overhead_periods` | Quarterly overhead totals | `/quarterly-overhead` |
| `overhead_overrides` | Per-client overhead allocation overrides | `/overhead-overrides` |
| `revenue_overrides` | Per-client revenue adjustments | `/revenue-overrides` |

These feed the margin / cost model (`v_meeting_costs`, `v_client_quarterly_pnl`).

### Ops tables (sync & app bookkeeping)

| Table | What it holds | Defined in |
|-------|---------------|-----------|
| `sync_runs` | One row per entity: `last_synced_at` watermark, `last_status`, `error_count`, `total_records`. The watermark drives incremental sync. | `sql/07_sync_tables.sql` |
| `sync_errors` | One row per row-level sync failure: `entity_name`, `dynamics_id`, `error_message`, `created_at`. | `sql/07_sync_tables.sql` |
| `deletion_candidates` | Records that vanished from Dynamics, awaiting admin review (`status` pending/dismissed, `label`, `raw_snapshot`, timestamps). | `sql/01_mirror_tables.sql` |
| `reconcile_runs` | One summary row per reconciliation sweep (`entities_checked`, `newly_flagged`, `reappeared`, `skipped`). | `sql/01_mirror_tables.sql` |
| `cron_send_log` | Idempotency ledger for scheduled emails — one row per `(job_key, sent_on)`. | `sql/18_cron_send_log.sql` |
| `user_roles` | Email → role (`super_user` / `user`) for access control. | `sql/17_user_roles.sql` |
| `user_id_aliases` | Maps duplicate Dynamics user GUIDs to a canonical id (feeds `canonical_user_id()`, used across productivity views). | (see `sql/` and view usage) |

### RLS posture

- v1 has **no meaningful row-level security** on the mirror/rose-owned tables — all reads go through the **service-role** key server-side (`getSupabaseServer()`), which bypasses RLS entirely. The app is internal-only.
- `user_roles` and `cron_send_log` have **RLS on with no policies**, so *only* the service-role client can read/write them — a deliberate lock-down of the sensitive tables.
- The sync client has INSERT/UPDATE grants on mirror tables but **not DELETE**; DELETE is granted separately for the reconciliation approval flow (so only an approved deletion can remove a mirror row). See [05](05-sync-and-integrations.md) and [08](08-runbook.md).

> **Repo-drift caveat:** a few objects exist in the live database but are missing from the local `sql/` files (e.g. the `v_capacity_account_roles` view; historically `tasks` / `new_vacationrequest` too). Rebuilding the schema purely from `sql/` could therefore miss them. The in-app **live panels** (Admin → Docs) list what actually exists right now — trust those over the repo when they disagree.
