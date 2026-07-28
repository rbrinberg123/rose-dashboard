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

Adding a whole new **entity** (not a field) is the case where `entities.ts` changes — add an `ENTITIES` object plus its mapper and its `create table` SQL.

### The two-Azure-apps caveat

The Dynamics sync and the Graph calendar integration use **separate Azure AD app registrations**:

| | Env vars | Scope | Permission |
|--|---------|-------|-----------|
| **Dynamics** (`lib/sync/dynamics.ts`) | `AZURE_TENANT_ID` / `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET` | `${DYNAMICS_BASE_URL}/.default` | Dataverse Application User |
| **Graph** (`lib/graph/token.ts`) | `GRAPH_TENANT_ID` / `GRAPH_CLIENT_ID` / `GRAPH_CLIENT_SECRET` | `https://graph.microsoft.com/.default` | `Calendars.ReadBasic.All` (admin-consented) |

The Graph app has **no** Dataverse access; the Dynamics app has **no** Graph permission. They previously shared the `AZURE_*` names, and pointing those at the Graph app broke the sync with a Dataverse *"user is not a member of the organization"* error. **Never merge them back** — even though the tenant is often the same directory, keep the vars explicit because they belong to different apps. This is documented in the `lib/graph/token.ts` header and in `.env.example`.

> **Graph access policy:** the calendar/mail Graph app is `RestrictAccess`-scoped to the `dashboards@` group. Any app-only `getSchedule` / `sendMail` caller must run as `dashboards@` or Graph returns 403. Keep the mailbox/service identity aligned with that group.
