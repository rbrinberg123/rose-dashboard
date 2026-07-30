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
- The **time-off** mirror table is named `new_vacationrequest` (this is what the sync writes and what `v_time_off` reads). An older `sql/15_ooo_table.sql` created a table named `ooo`; the live/used table is `new_vacationrequest`. Treat `new_vacationrequest` as authoritative.
- The DDL for these tables lives at repo root: `sql/01_mirror_tables.sql` (accounts, meetings, touchpoints, client_notes, contracts, users), `sql/14_tasks_table.sql` (tasks), `sql/16_events_table.sql` (events).

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
