# 05 — Sync & Integrations

## What it does (plain language)

The **sync** is the job that copies Dynamics into Supabase. It runs on a schedule (see [06 — Automations](06-automations.md)) and is designed to be cheap and safe:

- It only pulls records that **changed since the last run** (not the whole database every time).
- It **adds or updates** rows; it never deletes. (A separate "reconciliation" sweep handles deletions — safely, with human review.)
- Each entity syncs independently, so if one fails the others still succeed.

Separately, the **Microsoft Graph** integration reads calendars (free/busy) for the Host Calendar and Conference Rooms. The same sync run also **polls the data-crm@ shared mailbox** and turns each new email thread into a Data Upload task (see [data-crm@ mailbox poll](#data-crm-mailbox-poll--data-upload-tasks-2026-10-19)). Crucially, Graph and Dynamics use **two different Azure app registrations** — a distinction that has broken the sync before, so it's guarded carefully.

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

**Dashboard-owned rows are never swept.** On the 8 tables with an `origin` column (`hasOrigin` in `entities.ts`), the sweep reads only `origin='dynamics'` rows, and approve-delete refuses anything else. See [22 — Cutover: the ownership boundary](22-cutover-ownership-boundary.md).

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

> **Prefer the `_raw` backfill to a re-pull.** Because `fetchAll` sends **no `$select`**, `_raw` is the COMPLETE Dynamics record on every row — so any attribute Dynamics returned is already stored, and a new column can be filled with one `UPDATE … SET col = _raw ->> 'key'` instead of re-pulling the entity. The annotations are there too (`Prefer: odata.include-annotations="*"`), so a lookup backfill can read both the id (`_createdby_value`) and the display name (`_createdby_value@OData.Community.Display.V1.FormattedValue`) straight out of `_raw`.
>
> Wrap the `UPDATE` in `ALTER TABLE … DISABLE/ENABLE TRIGGER <table>_touch_synced_at`. A backfill is not a sync, and letting the trigger fire stamps `_synced_at = now()` on every row, destroying the staleness signal.
>
> `sql/patches/2026-09-16_flatten_raw_fields.sql` is the worked example — it added 27 columns across six tables this way, with no re-sync.

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
| **Graph** (`lib/graph/token.ts`) | `GRAPH_TENANT_ID` / `GRAPH_CLIENT_ID` / `GRAPH_CLIENT_SECRET` | `https://graph.microsoft.com/.default` | `Calendars.ReadBasic.All`, `Mail.Send` (admin-consented); **`Sites.Selected` + CRMDocuments write grant needed** for the memo upload, see below |

The Graph app has **no** Dataverse access; the Dynamics app has **no** Graph permission. They previously shared the `AZURE_*` names, and pointing those at the Graph app broke the sync with a Dataverse *"user is not a member of the organization"* error. **Never merge them back** — even though the tenant is often the same directory, keep the vars explicit because they belong to different apps. This is documented in the `lib/graph/token.ts` header and in `.env.example`.

> **Graph access policy:** the calendar/mail Graph app is `RestrictAccess`-scoped to the `dashboards@` group. Any app-only `getSchedule` / `sendMail` caller must run as `dashboards@` or Graph returns 403. Keep the mailbox/service identity aligned with that group.

### Graph permissions

The Graph app is **"Rose IQ Calendar Integration"**, app-only (client credentials; no signed-in user). Checked 2026-10-19 from its token's `roles` claim:

| Permission (application) | Used by | Status |
|---|---|---|
| `Calendars.ReadBasic.All` | `getSchedule` (host busy, conference rooms) | Granted |
| `Mail.Send` | `sendMail` (the email digests), limited by the Exchange Application Access Policy to `dashboards@roseandco.com` | Granted |
| `Mail.Read` | `listInboxMessages` (`lib/graph/mailbox.ts`): the data-crm@ mailbox poll ([below](#data-crm-mailbox-poll--data-upload-tasks-2026-10-19)). Limited by the same Access Policy, so **data-crm@ must be in its scope** | Granted (consent); **blocked by the Access Policy until data-crm@ is added** (403 checked 2026-10-19) |
| **`Sites.Selected`** + **write** on the CRMDocuments site | `uploadToCrmDocuments` (`lib/graph/sharepoint.ts`): the Marketing Memo document upload ([14 — Tasks](14-tasks.md#marketing-memo-document-2026-10-19)) | **Needs granting** |

**To grant the SharePoint access (an Azure / SharePoint admin, no env change):**

1. Azure portal → App registrations → *Rose IQ Calendar Integration* → API permissions → Add → Microsoft Graph → **Application** → **`Sites.Selected`** → **Grant admin consent**.
2. Give this app **write** on `https://rosecoglobal.sharepoint.com/sites/CRMDocuments`. `Sites.Selected` grants nothing until this step. Either:
   - PnP PowerShell: `Grant-PnPAzureADAppSitePermission -AppId <GRAPH_CLIENT_ID> -DisplayName "Rose IQ Calendar Integration" -Site https://rosecoglobal.sharepoint.com/sites/CRMDocuments -Permissions Write`
   - or Graph (as an admin with `Sites.FullControl.All`): `POST /sites/{siteId}/permissions` with `{"roles":["write"],"grantedToIdentities":[{"application":{"id":"<GRAPH_CLIENT_ID>","displayName":"Rose IQ Calendar Integration"}}]}`. Find the site id with `GET /sites/rosecoglobal.sharepoint.com:/sites/CRMDocuments`.
3. Nothing to redeploy: the next token picks the permission up. A cached token lives up to an hour, so allow that long.

The broader alternative is `Sites.ReadWrite.All`: one checkbox, but write access to **every** site in the tenant. `Sites.Selected` limits the app to this one site. The Exchange Application Access Policy doesn't apply to SharePoint, and uploads show in SharePoint as modified by the app, not the person (who uploaded is stored on the task). Until the grant is in place, an upload fails with *"SharePoint upload isn't enabled yet…"*, never silently.

Calls used: `GET /sites/{host}:/sites/CRMDocuments` → site id; `GET /sites/{siteId}/drive` → the Documents library (both cached per warm instance); `PUT /drives/{driveId}/root:/{name}:/content?@microsoft.graph.conflictBehavior=rename` (new file) or `PUT /drives/{driveId}/items/{itemId}/content` (new version). Simple upload only, which suits files of 4 MB and under.

### data-crm@ mailbox poll → Data Upload tasks (2026-10-19)

**Plain language:** when someone emails **data-crm@roseandco.com**, a **Data Upload** task appears on **Tools → Data Uploads** within about ten minutes (weekdays, during the sync window). One task per email **thread**: replies don't make more tasks. The task is unassigned, due in 7 days, and whoever marks it complete becomes its owner.

**When it runs:** inside the Dynamics sync cron, `/api/sync-dynamics` (every 10 min, 11:00–22:59 UTC, Mon–Fri; also Admin → Sync "Run now"). It is a **separate step after `runSync()`** and never throws, so the Dynamics sync and the poll cannot fail each other. Its outcome is the `mailPoll` key of the route's JSON (`status`, `fetched`, `tasksCreated`, `replies`, `failed`, `watermark`, `message`); `error` / `partial` make the route return 207. Mail that arrives outside the window waits for the next run. **Locally** the poll runs too if you call the route, but the 403 below applies until the policy is fixed.

**Graph:** `GET /users/data-crm@roseandco.com/mailFolders/Inbox/messages?$filter=receivedDateTime ge {watermark − 10 min}&$orderby=receivedDateTime asc&$select=id,internetMessageId,conversationId,subject,from,receivedDateTime,webLink,bodyPreview,hasAttachments`, 50 per page, at most 10 pages per run (the rest follows next run). App-only as **Rose IQ Calendar Integration** via `graphFetch`; the full body is never fetched.

> **Needs an Exchange admin before it works (checked 2026-10-19):** the app's token has `Mail.Read`, but the read returns **403 "Blocked by tenant configured AppOnly AccessPolicy settings"** because the Application Access Policy is `RestrictAccess`-scoped to the dashboards@ group. Add **data-crm@roseandco.com** to that group, then check with `Test-ApplicationAccessPolicy -Identity data-crm@roseandco.com -AppId <GRAPH_CLIENT_ID>` (expect `Granted`). Allow up to ~1 hour to propagate. Side effect: the same app may then also `Mail.Send` as data-crm@ (the policy is per app, not per permission). Until then every poll records `last_status = 'error'` with the 403 in `mail_poll_state.last_error`, and nothing else happens.

**Per message** (`lib/data-upload/poll.ts`):

| Case | Recorded as | Task |
|---|---|---|
| `internet_message_id` already in `data_crm_mail_messages` | (skipped, nothing written) | — |
| Sent **by** data-crm@ itself | `skip_reason = 'own_mail'` | — |
| **First** message seen in its `conversationId` | `task_id` set | **one new Data Upload task** |
| Any later message in that conversation | `skip_reason = 'reply'` | — |

Reply detection is **`conversationId` only**, with no "RE:" subject collapsing, because generic subjects ("Data upload") would merge separate submissions. If an original email arrived before go-live, its first reply creates the task.

**Idempotency:** three dashboard-owned tables (`sql/patches/2026-10-19b_data_crm_mail.sql`, **run it first**):

- `mail_poll_state`: the **watermark** per mailbox (`last_received_at`) plus the last run's status, error and counts. The **first run initialises it to now, with no backfill**. To backfill, move `last_received_at` back by hand (the patch shows how).
- `data_crm_mail_conversations`: PK `conversation_id`. The first message **claims** the conversation (insert-or-ignore) and its `task_id` is chosen **at claim time**. The task is then inserted with that id (insert-or-ignore), so a retry after a crash can never create a second task. `task_created_at` marks the insert.
- `data_crm_mail_messages`: PK `internet_message_id` (the Graph `id` changes when a message is moved, so it is kept as `graph_message_id` only). This row is written **last**, so a crash anywhere earlier just reprocesses that message next run.

The **watermark** advances to the newest message processed. If any message failed, it holds at the earliest failure (never moving backwards), so the failed message is retried. Every read re-covers the last 10 minutes, and the message-id dedup absorbs that overlap. RLS is on with no policies (service role only).

**The task** (`lib/data-upload/rules.ts`, unit-tested in `rules.test.ts`): Outreach / **Data Upload** (the existing `755860003` / `755860000` pair), `origin = 'dashboard'`, `created_by_name = 'Data CRM mailbox'` (this is how the page and Mark complete recognise mailbox tasks), Open / Not Started, **no owner**, created now, **due = Eastern today + 7 days** (Eastern midnight, `scheduled_end`). The description holds the sender, received time, original subject, client match and the email's preview. Every create is audited (`context = automation:data-upload:mailbox`).

**Title and client match (revised 2026-10-19):** `Data Upload – <client> – <subject>` (RE:/FW: stripped, max 200 characters). The client part is the ticker (or name) of the matched client, added **only for a single confident match**, and left out when the subject already shows it. With no subject the title is `Data Upload – from <sender>`.

**Where it looks:** the **subject**, the **attachment file names** (names only, via `GET …/messages/{id}/attachments?$select=name,isInline`; inline images skipped, no content ever fetched) and the **plain-text body** (`GET …/messages/{id}?$select=body` with `Prefer: outlook.body-content-type="text"`, first 20,000 characters, used for matching only and never stored). These two extra reads happen only for the **first email of a thread**. If either read fails, matching uses what it has and the message row records `match_source = 'none:subject-only'`; the message never fails because of it. Matching is against **active** clients only (`state_label = 'Active'`).

**Rules** (`findClientCandidates` / `matchClient` in `lib/data-upload/rules.ts`, unit-tested):

1. **Ticker:** an UPPERCASE **whole word** equal to a client's **base** ticker, 2+ characters, never a partial match. `ticker_symbol` is stored with a country suffix for almost every client (`ADT-US`, `WDS-AU`; 105 of 108 active accounts on 2026-10-19), so the suffix is dropped first (`tickerBase`), and "ADT" or "ADT-US" both match `ADT-US`. File names split on `_`, `-`, spaces and dots, so `SNX - batch.xlsx` and `ADT.xlsx` give SNX / ADT. A blocklist of common words that are also tickers (ON, IT, OR, ALL, ARE, NEW, US, PDF, CSV…) never matches.
2. **Name:** the client name with legal suffixes stripped (Inc, Corp, LLC, Ltd, Co, PLC, Holdings, Group, …), giving two **fragments**: the whole remaining name, and its first word. Each counts only if it is **4+ characters** and **not a generic word** (a blocklist: data, upload, report, email, energy, gold, capital, first, global, great, …). A fragment matches **case-insensitively as a substring starting at a word boundary**, so "Woodside's" matches, but "ePayPal" doesn't.
   - **In the body, only the full name counts.** A first word alone is too weak in prose: the real case was "had a *great* weekend" against Great-West Lifeco.
   - A name hit that is only part of another client's longer or full-name hit is ignored. So "Acme Bank" is Acme Bank, not also Acme Corp.
3. **Single match only:** everything found across the subject, attachment names and body is pooled. **Exactly one distinct client** means it is set on the task (`bcs_account_id`, `bcs_account_name` and Regarding). **Two or more** means none is set (`match_source = 'ambiguous:<n>'`). The poll never guesses.
4. **Sender domain (fallback, only when the text names nobody):** the sender's domain equals exactly one client's `website_url` or `email` domain. roseandco.com and free-mail domains never count.

`data_crm_mail_messages.match_source` records how the client was set, as `<rule>:<where>` (e.g. `ticker:attachment`, `name:body`, `sender_domain:sender`), or why not (`ambiguous:2`, `none:subject-only`). The card shows this under the Client field.

**Measured on the real data-crm@ Inbox (2026-10-19, 8 messages):** 7 resolved to the right client and 1 test email to none. The planning thread → TD Synnex, from "SNX" in the body or attachment name and "TD Synnex" in the signature. The automated IHS Markit execution report → SNX, from its attachment names. "…for ADT" → ADT. The analyst-meeting thread → Leidos, from "LDOS" in the Cc. Before the body guard, the planning thread was wrongly ambiguous because of "Great-West Lifeco".

A completed Data Upload task with a client moves that client's dashboard events' **Last Data Upload** date through the existing `event-last-data-upload` trigger ([06 — Automations](06-automations.md)). So a wrong match matters, which is why the matcher prefers no client over a guess, and the client must be confirmed before close ([14 — Tasks](14-tasks.md#data-upload-tasks-from-data-crm-2026-10-19)).
