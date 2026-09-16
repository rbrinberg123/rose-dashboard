# 05 — Sync & Integrations

## What it does (plain language)

The **sync** is the job that copies Dynamics into Supabase. It runs on a schedule (see [06 — Automations](06-automations.md)) and is designed to be cheap and safe:

- It only pulls records that **changed since the last run** (not the whole database every time).
- It **adds or updates** rows; it never deletes. (A separate "reconciliation" sweep handles deletions — safely, with human review.)
- Each entity syncs independently, so if one fails the others still succeed.

Separately, the **Microsoft Graph** integration reads calendars (free/busy) for the Host Calendar and Conference Rooms. Crucially, Graph and Dynamics use **two different Azure app registrations** — a distinction that has broken the sync before, so it's guarded carefully.

## Technical

### Files

| File | Role |
|------|------|
| `dashboard/lib/sync/entities.ts` | The `ENTITIES` list — what to sync and how to key it. |
| `dashboard/lib/sync/mappers.ts` | One mapper per entity: turns a Dynamics record into a mirror-table row. |
| `dashboard/lib/sync/dynamics.ts` | The Dynamics Web API client (auth, paging, `$filter`). |
| `dashboard/lib/sync/run.ts` | `runSync()` — orchestrates the pull → map → upsert per entity. |
| `dashboard/lib/sync/reconcile.ts` | `runReconciliation()` — the deletion-detection sweep. |
| `dashboard/app/api/sync-dynamics/route.ts` | Cron/admin entry point for the sync. |
| `dashboard/app/api/reconcile-dynamics/route.ts` | Cron/admin entry point for reconciliation. |

### Incremental sync — the `modifiedon` watermark

Each entity's watermark is stored in `sync_runs.last_synced_at` (PK = `entity_name`). Before pulling an entity, the sync reads that timestamp:

```ts
// dashboard/lib/sync/run.ts
const modifiedSince = runRow?.last_synced_at ?? null
const fullPull = modifiedSince === null
```

and applies it as a Dynamics OData filter:

```ts
// dashboard/lib/sync/dynamics.ts
if (modifiedSince) {
  url += `?$filter=${encodeURIComponent(`modifiedon gt ${modifiedSince}`)}`
}
```

- **First run for an entity** (no `sync_runs` row) → `modifiedSince` is null → **full pull**, no filter.
- After a successful/partial run, the watermark advances to the **run's start time** (captured once at the top of the run).
- On an **entity-level failure**, the watermark is left **unchanged**, so the next run retries the same window.

### Upsert-only — deletes never propagate

Writes are upserts keyed on the entity's PK:

```ts
// dashboard/lib/sync/run.ts
await sb.from(entity.table).upsert(batch, { onConflict: entity.pk })   // 500-row batches
```

Because the sync is incremental + upsert-only, a **hard delete in Dynamics never removes the mirror row** — the row is simply never touched again. That's what the reconciliation sweep is for. (The sync's DB grants are INSERT/UPDATE only; DELETE is granted separately for the approval flow.)

### The reconciliation sweep (`reconcile.ts`)

Runs after the sync (its own cron). Per entity:

1. **Pull live PKs** from Dynamics (`$select=<idField>` only — cheap, read-only, full list).
2. **Read mirror PKs** (paging past the 1000-row PostgREST cap).
3. **Diff** (case-insensitive GUID compare): mirror rows whose PK isn't in the live set are **deletion candidates**.
4. **Safety guard:** if the live-ID fetch errored, or returned **zero** ids while the mirror still has rows, that entity is **skipped** — a transient Dynamics outage can never flag a whole table for deletion.
5. **Self-heal:** any pending/dismissed candidate whose PK is live again is removed from the queue.

It writes:
- **`deletion_candidates`** — the review queue (`status='pending'`, a human-readable `label`, a `raw_snapshot` with `_raw` stripped out, timestamps). Upserted on `(entity_name, pk_value)`, ignoring duplicates.
- **`reconcile_runs`** — one summary row per sweep.

The sweep **never deletes mirror data** — an admin approves each removal at `/admin/reconciliation`. See the recovery recipe in [08 — Runbook](08-runbook.md).

An entity can be excluded from the sweep entirely with `skipDeletionSweep` — see [Opting an entity out of the deletion sweep](#opting-an-entity-out-of-the-deletion-sweep-skipdeletionsweep) below.

### Field-type helpers (`mappers.ts`)

There is **one mapper per table**, and its object keys are literally the mirror-table column names, so the result goes straight into the upsert. Helpers at the top of the file:

| Helper | Does |
|--------|------|
| `fv(row, field)` | Returns the OData **FormattedValue** — used for option-set / choice **labels**. |
| `lookupId(row, field)` | The raw GUID in a `_xxx_value` **lookup** field. |
| `lookupName(row, field)` | The resolved **display name** for a lookup. |
| `parseDt(value)` | Normalizes empty dates to `null`; passes ISO strings through. |
| `num(value)` | Null-safe number (money, counters, option-set codes). |
| `str(value)` | Null-safe string. |
| `bool(value)` | Null-safe boolean (Yes/No fields). |

Conventions produced: choice → `{field}_code` + `{field}_label`; lookup → `{field}_id` + `{field}_name`; multi-select → `{field}_codes` + `{field}_labels`; polymorphic lookups also capture the target entity type (e.g. `regarding_type`). Every mapper except `mapSystemUser` also writes `_raw: row`.

> The mappers are a deliberate TypeScript port of `loader/load.py` and are **kept in lockstep** with it. If you change one, mirror the change in the other.

### Procedure: add a new Dynamics **field** to an existing table

The entity *list* is data-driven, but individual *fields* are hand-modeled. Minimal steps:

1. **Add the column to the mapper** in `mappers.ts` — pick the right helper (`str`/`num`/`bool`/`parseDt` for scalars; the `lookupId`+`lookupName` pair for lookups; `num`+`fv` pair for choices). The object key must equal the SQL column name.
2. **Add the matching column in SQL.** For a table not yet deployed, edit its `create table` file (`sql/01_mirror_tables.sql`, `14_tasks_table.sql`, or `16_events_table.sql`). For an **already-deployed** table, add an `ALTER TABLE` under `sql/patches/` (the established convention — e.g. `sql/patches/2026-07-27_meeting_event_logistics_fields.sql`) and run it in Supabase.
3. **Keep `loader/load.py` in lockstep** (the manual/backfill path must write the same shape).
4. Nothing else needs to change — `entities.ts`, `run.ts`, `dynamics.ts`, and the routes don't enumerate fields, and `_raw` already holds the value.

**Backfill caveat:** the sync requests all attributes, so the new field flows in for rows **modified after** the next run. Unchanged historical rows won't get the new column populated until you either reset that entity's `sync_runs` watermark (forcing a full re-pull) or backfill from `_raw`. See [08 — Runbook](08-runbook.md).

Adding a whole new **entity** (not a field) is the case where `entities.ts` changes — add an `ENTITIES` object plus its mapper and its `create table` SQL. If the new table declares a `_synced_at` column, also attach the `touch_synced_at` trigger — and if it does **not**, make sure you do not (see the next section).

### Opting an entity out of the deletion sweep (`skipDeletionSweep`)

`EntityConfig` carries an optional `skipDeletionSweep?: boolean`. The reconciliation sweep pulls the **full** primary-key list from Dynamics for every entity, every day — trivial for 228 accounts, wasteful for a very large entity. Setting the flag excludes that entity from `runReconciliation()` entirely:

```ts
// dashboard/lib/sync/reconcile.ts
if (entity.skipDeletionSweep) continue
```

Opted-out entities are **omitted**, not reported as skips, so the sweep's `skipped` counter keeps meaning *"the safety guard fired"* rather than becoming a daily false alarm people learn to ignore.

**The trade-off:** a record hard-deleted in Dynamics lingers in that mirror table indefinitely, because the incremental sync is upsert-only and nothing else detects deletions. Only set the flag where a stale row is low-stakes. `contacts` is currently the only entity using it.

### Entity: `contacts` (sync only, added 2026-09-16)

The Dataverse `contact` entity — the people at client companies. **Sync only: there is no contacts page, view, or filter-options view yet.** The table fills up in the background so the client-link question below can be answered from real data.

| | |
|--|--|
| Dynamics entity set | `contacts` (PK `contactid`) |
| Mirror table | `public.contacts` (PK `contact_id`) |
| Mapper | `mapContact` in `lib/sync/mappers.ts` |
| DDL | `sql/23_contacts_table.sql` |
| Deletion sweep | **Opted out** (`skipDeletionSweep: true`) |

Modeled throughout on `tasks`, which is the same situation: a standard Dataverse entity that Rose has heavily customized with `bcs_*` fields.

#### The client link is deliberately UNDECIDED

Two candidate fields tie a contact to a client account, and **both are mirrored** rather than one being picked in advance:

| Column(s) | Dynamics field | Dynamics label |
|---|---|---|
| `parent_customer_id` / `_name` / `_type` | `_parentcustomerid_value` | Company Name |
| `company_master_record_id` / `_name` | `_bcs_companymasterrecord_value` | Master Company Record |

Carrying both costs a handful of nullable columns, which is far cheaper than guessing wrong and rebuilding views later.

**`parentcustomerid` is polymorphic** — in Dynamics it points at *either* an account *or* a contact. That is why it gets the full id/name/**type** triple, exactly like `regardingobjectid` on tasks. **Always filter on `parent_customer_type = 'account'` before joining to `accounts`**, or you will silently mix two entity types in one column. (`touchpoints.regarding_id` has this problem today: it stores the GUID with no type.)

To choose the canonical link once contacts have synced, compare populate rate and match rate:

```sql
select
  count(*)                                                           as contacts,
  count(parent_customer_id)                                          as parent_populated,
  count(company_master_record_id)                                    as master_populated,
  count(*) filter (where parent_customer_id in (select account_id from public.accounts))       as parent_matches_accounts,
  count(*) filter (where company_master_record_id in (select account_id from public.accounts)) as master_matches_accounts
from public.contacts;
```

Read the result carefully: `public.accounts` holds only Rose's ~228 **client** accounts, not all of Dynamics, so every contact at a non-client company fails to match **by design**. A low absolute match rate is expected and is not disqualifying — the field to prefer is the one that matches well *for contacts that are actually at client companies*.

#### Flattened columns vs `_raw`

Flattened (the curated set): the standard backbone (`first_name`, `last_name`, `full_name`, `job_title`, `created_on`, `modified_on`, `state_code`/`state_label`, `status_code`/`status_label`); both client-link candidates; the choice fields `contact_type`, `industry`, `internal_assignment`, `lead_state` (`bcs_state`), `state_for_address`, `last_activity_type` — each as the standard `_code` + `_label` pair; the Yes/No fields `distribution_list`, `do_not_call`, `ex_employee`, `ir_only`, `poc`; and `last_activity_subject`, `last_activity_time`, `previous_company`, `ticker_symbol`, `verified_on`.

Left in `_raw` on purpose: the activity-pointer lookups (last appointment / email / phone / task activity), primary opportunity, segment id, the country lookup, and `parent_contactid`. **Nothing is lost** — `_raw` holds the complete Dynamics payload, so promoting any of these to a real column later is an `ALTER TABLE` plus a `_raw` backfill, no re-sync required.

> **Unverified field shapes.** The six choice fields above were modeled as option sets (`integer` code + `text` label) without being able to read the Dynamics metadata first. If any of them is really a text or lookup attribute, its `_code` column will reject the value and those rows will land in `sync_errors` with a type error — visible at `/admin` after the first run. The fix is one line each: drop the `_code` column to `text`, or switch the mapper to the `lookupId`+`lookupName` pair. **Check `sync_errors` after the first contacts run.**

#### `_synced_at` is present — and so is its trigger

`public.contacts` declares `_synced_at`, and `sql/23_contacts_table.sql` attaches `contacts_touch_synced_at`. That pairing is deliberate and must stay matched — see the `public.users` incident in the next section for what happens when a table gets the trigger without the column.

#### Backfill: forcing the first full pull

The sync is incremental off `sync_runs.last_synced_at`. With **no row** for `contacts`, the first run is automatically a full pull — so a fresh deployment needs nothing. Run this only to *re-force* a full backfill (for example after adding a column):

```sql
-- entity_name must be exactly 'contacts' (EntityConfig.name in entities.ts)
delete from public.sync_runs where entity_name = 'contacts';
-- or, keeping the bookkeeping row:
update public.sync_runs set last_synced_at = null where entity_name = 'contacts';
```

The next scheduled sync (every 10 minutes on weekdays — see [06 — Automations](06-automations.md)) then pulls every contact. Order matters only in that `accounts` syncs first, so the client-link comparison above is valid on the same run.

### `public.users` has no `_synced_at` — never attach the trigger to it

Eight of the nine mirror tables carry a `_synced_at` column, stamped on every write by the `public.touch_synced_at()` `BEFORE INSERT OR UPDATE` trigger.

**`public.users` is the exception.** It has no `_synced_at` and no `_raw`; it records freshness with **`first_seen_at` / `last_seen_at`**, and `mapSystemUser` writes `last_seen_at` on every run (`first_seen_at` is deliberately omitted from the payload so the `DEFAULT now()` survives on the upsert's UPDATE path).

Attaching `touch_synced_at` to `users` does not fail at `CREATE TRIGGER` time — plpgsql resolves `NEW._synced_at` at **runtime** — so the breakage only shows up on the next sync, where every `users` upsert throws:

```
record "new" has no field "_synced_at"
```

This happened for real between 2026-09-11 and 2026-09-16: no new or changed Dynamics user mirrored in for five days, and those users could not be granted roles or appear in permissions at all. Because `syncEntity` marks a batch-level upsert failure as `partial` and **still advances the watermark**, recovery also required a forced full re-pull (`UPDATE public.sync_runs SET last_synced_at = NULL WHERE entity_name = 'systemusers';`), not just dropping the trigger.

Full write-up, plus the audit query that lists every `touch_synced_at` attachment against whether the table really has the column, is in [03 — Data Model](03-data-model.md#_synced_at--last-synced).

### The two-Azure-apps caveat

The Dynamics sync and the Graph calendar integration use **separate Azure AD app registrations**:

| | Env vars | Scope | Permission |
|--|---------|-------|-----------|
| **Dynamics** (`lib/sync/dynamics.ts`) | `AZURE_TENANT_ID` / `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET` | `${DYNAMICS_BASE_URL}/.default` | Dataverse Application User |
| **Graph** (`lib/graph/token.ts`) | `GRAPH_TENANT_ID` / `GRAPH_CLIENT_ID` / `GRAPH_CLIENT_SECRET` | `https://graph.microsoft.com/.default` | `Calendars.ReadBasic.All` (admin-consented) |

The Graph app has **no** Dataverse access; the Dynamics app has **no** Graph permission. They previously shared the `AZURE_*` names, and pointing those at the Graph app broke the sync with a Dataverse *"user is not a member of the organization"* error. **Never merge them back** — even though the tenant is often the same directory, keep the vars explicit because they belong to different apps. This is documented in the `lib/graph/token.ts` header and in `.env.example`.

> **Graph access policy:** the calendar/mail Graph app is `RestrictAccess`-scoped to the `dashboards@` group. Any app-only `getSchedule` / `sendMail` caller must run as `dashboards@` or Graph returns 403. Keep the mailbox/service identity aligned with that group.
