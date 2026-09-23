# 18 — Audit trail

> **Status: built, SQL PENDING.** `sql/patches/2026-09-15c_audit_log.sql` has not been run yet. Until it is, every `recordAudit` call fails soft — it warns on the server console and returns, and **no save is affected**. The table is also in the base DDL (`sql/02_rose_owned_tables.sql`).
>
> **Viewer:** `/admin/audit-log` (Admin hub → *In-app tools* → **Audit Log**), super-user only, read-only.
>
> **Not yet pushed to any remote.** The application code is local-only.

## The rule

> **Every server action or route handler that inserts, updates or deletes data on a person's behalf MUST call `recordAudit`.**

No exceptions, and no second logging mechanism. If it is not in `audit_log`, it did not happen as far as the trail is concerned. Adding a write feature is three lines:

```ts
const before = await readRow(id)          // for update / delete
... the existing mutation ...
await recordAudit({
  action: "update",
  entity: "my_table",
  recordId: id,
  changes: diffRows(before, patch),
})
```

## Why now

There was **no history table of any kind** before this, and several write surfaces recorded nothing about who changed what:

| Table | What it recorded before |
|---|---|
| `role_page_access` | **nothing** — no actor, no timestamp. A permission change left no trace but the permission |
| `user_data_scopes` | **nothing** |
| `client_todo_notes` | `updated_at` only — no actor, and the upsert is last-write-wins, so the previous text was simply gone |
| `cost_assumptions` | `updated_at` only |
| `revenue_overrides` | `created_at` only |
| `client_direct_costs` | `created_at` / `created_by` |
| `overhead_*`, `salary_schedule` | `created_at` / `updated_at` — no actor |
| `account_team_members`, `account_status` | `created_by` / `updated_by` / `changed_by` (the newest tables, and the only well-covered ones) |

Establishing the trail while the surface area is small — 18 actions across 13 tables — means every future write feature has one obvious place to log to, instead of thirteen tables each growing their own half-answer.

## The table

`public.audit_log` — append-only.

| Column | Notes |
|---|---|
| `id` | `bigint GENERATED ALWAYS AS IDENTITY` |
| `occurred_at` | `timestamptz`, defaults to `now()` |
| `actor_user_id` | the `public.users` id. **No FK** — see below |
| `actor_email` | resolved server-side from the verified session |
| `action` | `create` \| `update` \| `delete` (CHECK-constrained) |
| `entity` | the table or feature name, e.g. `account_team_members`, `accounts.ai_summary` |
| `record_id` | **text**, so a uuid, a bigint, or a composite key all fit one column |
| `changes` | `jsonb` — see the shapes below |
| `context` | short breadcrumb: the page path, `· bulk`, `view-as:…` |

Indexed on `(entity, record_id, occurred_at DESC)` for one record's history, `occurred_at DESC` for the activity feed, and `(actor_email, occurred_at DESC)` for "what has this person changed".

**No foreign key on `actor_user_id`, deliberately.** The trail must survive the person: an FK would either block a `users` row being removed or cascade the history away with it, and an audit record that can be erased by tidying up the user table is not an audit record.

### The `changes` shapes

**update** — only the fields that actually changed:

```json
{ "is_active": { "old": true, "new": false } }
```

**create / delete** — the full row snapshot:

```json
{ "role": "associate", "user_id": "…", "source": "manual" }
```

## Append-only — enforced, not merely intended

Two guards, because they fail differently:

- **`REVOKE UPDATE, DELETE … FROM service_role`** — the permission answer. The key the app uses cannot issue either statement.
- **A `BEFORE UPDATE OR DELETE` trigger that raises** — the behaviour answer. It catches a superuser or the table owner, who the REVOKE does not constrain — which is exactly who is typing in the Supabase SQL editor.

**To correct a bad entry: do not update it. Append a new row describing the correction.** To purge old rows under a future retention policy: drop the trigger, delete, recreate the trigger — deliberately, in one reviewed migration.

## The helper

`dashboard/lib/audit.ts` exports three things:

- **`recordAudit({ action, entity, recordId, changes, context })`** — resolves the actor and appends one row.
- **`diffRows(before, after)`** — the field-level diff. Compares only the keys present in `after` (the fields the write actually touched), so an update of two columns does not report the other thirty. Returns `null` when nothing changed, which call sites use to **skip logging a no-op save**.
- **`snapshot(row)`** — a row snapshot for creates and deletes, with `_raw` and `_synced_at` stripped (a Dynamics payload in every log row would be absurd).

### The actor is the *real* person, not the impersonated one

`getEffectiveIdentity()` returns the **impersonated** person while a super-user is in "View as". That is right for deciding what they may see and **wrong for recording who did something** — it would file a super-user's action under somebody else's name, which is precisely the attribution an audit trail exists to prevent.

So `recordAudit` reads the real signed-in user straight from Supabase Auth (the authenticity check itself, never a cookie) and, when a View-as cookie is present, notes it in `context` as `view-as:<email>`. Today every impersonation-capable write is already refused while impersonating; this keeps the trail correct regardless of whether that stays true.

### It must never break a save

`recordAudit` **never throws and never returns an error**. If the insert fails — the table does not exist yet, the database is briefly unreachable — it warns on the server console and returns.

That is a deliberate trade: completeness of the trail is sacrificed to availability of the app. It is the right way round *here* because the trail is a **record of what the app did, not a control on what it may do** — nothing grants or denies access based on it. **If this ever becomes a compliance control rather than a history, revisit that decision explicitly.**

## What is wired

32 call sites across 13 files.

| Write surface | Entity logged | Actions |
|---|---|---|
| `assignRole` | `account_team_members` | create / update |
| `clearRole` | `account_team_members` | delete |
| `setAccountStatus` | `account_status` | create / update |
| `saveClientTodoNote` | `client_todo_notes` | create / update |
| `setRolePageAccess` | `role_page_access` | create / update |
| `setRoleDataPermission` | `role_data_permission` | create / update |
| `setUserRole` | `user_role_grants` | create / update / delete |
| `createSavedView` | `<entity>_saved_views` | create |
| `updateSavedView` | `<entity>_saved_views` | update |
| `setDefaultSavedView` | `<entity>_saved_views` | update (×2 branches) |
| `deleteSavedView` | `<entity>_saved_views` | delete |
| `deleteCandidate` / `deleteCandidates` | **the mirror table** | delete |
| `dismissCandidate` / `dismissCandidates` | `deletion_candidates` | update |
| `updateCostAssumptions` | `cost_assumptions` | update |
| `addDirectCost` / `deleteDirectCost` | `client_direct_costs` | create / delete |
| `addRevenueOverride` / `deleteRevenueOverride` | `revenue_overrides` | create / delete |
| `upsertOverheadOverride` / `deleteOverheadOverride` | `overhead_overrides` | create / update / delete |
| `upsertOverheadPeriod` / `deleteOverheadPeriod` | `overhead_periods` | create / update / delete |
| `upsertSalary` / `deleteSalary` / `recordRaise` | `salary_schedule` | create / update / delete |
| `GET /api/client-summary` | `accounts.ai_summary` | update |

The **saved-views** module is shared by all five CRM tables, so wiring it once covers Meetings, Events, Tasks, Touches and Notes; `entity` is the concrete table so they do not land in one undifferentiated pile.

### Judgement calls in the wiring

- **Slot-keyed record ids.** `account_team_members` logs `recordId` as `"<account_id>|<role>"`, not the row's uuid — the uuid is replaced on every reassignment, so keying on it would scatter one slot's history across a new id each time. `role_page_access` likewise uses `"role:…|route:…"`, since the table's key is composite.
- **A raise is one event, not two.** `recordRaise` end-dates the old row *and* inserts a new one. It logs **one** `create` carrying both halves; two entries would read as an unrelated edit followed by an unrelated addition.
- **Deletion reconciliation logs against the mirror table**, not `deletion_candidates` — someone later asking "where did this account go?" will search for the account's id, not for the bookkeeping row that approved its removal. This is the one place the app hard-deletes synced data, so it is the most important delete in the system to have a trail for. Both the single and bulk paths funnel through one helper, so both are covered.
- **Setting a default logs once**, on the entity, rather than once for clearing the old default and once for setting the new one.
- **No-ops are not logged.** Where `diffRows` returns `null`, or a `.eq("status","pending")` guard meant no row moved, nothing is appended.

## What is deliberately *not* audited

Background machinery that writes on a **schedule** rather than on a person's behalf:

| Excluded | Why |
|---|---|
| `lib/sync/run.ts` | the nightly Dynamics sync — tens of thousands of mirror upserts a night |
| `lib/sync/reconcile.ts` | the sweep's own bookkeeping (`reconcile_runs`, candidate housekeeping) |
| `lib/live-outreach-send-log.ts` | `cron_send_log` |
| `/api/client-summary/refresh-all` | the nightly batch — 228 entries a night |

These already have purpose-built run logs (`sync_runs`, `sync_errors`, `reconcile_runs`) and putting them here would bury the human trail under machine noise.

**A human acting on something the machinery produced *is* audited** — dismissing a deletion candidate, or regenerating one client's summary from the Client Detail page — because that is a person making a decision.

## One shape change, no behaviour change

Four inserts gained `.select("id")` so the audit entry can carry the new row's id (`client_direct_costs`, `revenue_overrides`, the `recordRaise` insert, and the reconciliation dismiss statements). That adds a `RETURNING` clause and changes nothing about what is written or what the action returns.

Nothing else about any mutation changed: same tables, same values, same guards, same errors, same `revalidatePath`. No read path, page, or permission was touched.

## Reading the log

```sql
-- Recent activity.
SELECT occurred_at, actor_email, action, entity, record_id, context
  FROM public.audit_log ORDER BY occurred_at DESC LIMIT 50;

-- One record's full history.
SELECT occurred_at, actor_email, action, changes
  FROM public.audit_log
 WHERE entity = 'account_team_members' AND record_id = '<account_id>|associate'
 ORDER BY occurred_at;

-- Coverage: which surfaces have actually logged anything yet.
SELECT entity, action, count(*), max(occurred_at) AS last_seen
  FROM public.audit_log GROUP BY 1,2 ORDER BY 1,2;

-- Both of these MUST fail with "audit_log is append-only".
UPDATE public.audit_log SET context = 'tampered' WHERE id = 1;
DELETE FROM public.audit_log WHERE id = 1;
```

## The viewer page

**`/admin/audit-log`** — Admin hub → *In-app tools* → **Audit Log**. Super-user only, read-only.

### Read-only, structurally

The page and its `actions.ts` contain **no insert, update or delete of any kind** — verified: the only database calls are `select`s against `audit_log`, `accounts` and `users`. That is belt-and-braces on top of the database, which blocks mutation outright. A write from this page would fail loudly rather than corrupt the trail.

### Columns

| Column | Notes |
|---|---|
| **When** | `occurred_at`, Eastern, **date and time** — an audit entry's minute matters |
| **Actor** | `actor_email` resolved to a friendly name + avatar. A **view-as** badge appears where the action was taken while impersonating |
| **Action** | create / update / delete, as a coloured pill |
| **Entity** | the friendly label — `account_team_members` → "Account Team", `note_saved_views` → "Saved View · Notes", and so on. CRM (Dynamics-mirror) tables use **plain names** — `client_notes` → "Client Note", `touchpoints` → "Touch", `contacts` → "Contact" — plus an **origin badge** (below) |
| **Record** | the record id made readable. Account-keyed records resolve to the **client name** and link to Client Detail |
| **Summary** | a one-line rendering of `changes` — e.g. *"Account Manager: — → Brian Smith"* |

An entity with no registered label falls back to a title-cased version of the raw name, so a new write surface that forgets to register is still legible rather than invisible. It is also missing from the Entity filter dropdown, which is built from the same list. That's why **Contacts** was unfilterable until it was registered (2026-09-23).

**Origin badge — who authored the audited record.** The CRM tables used to carry a "(mirror row)" suffix, from when a reconciliation hard-delete was the only way they reached the log. Since the dashboard started creating its own rows in those same tables (Add New Contact / Note / Touch, [22 — Cutover](22-cutover-ownership-boundary.md)), the table alone no longer says who owns a row. So the suffix is gone, and each **entry** gets a small badge next to the entity, in the list and in the drawer header:

| Badge | When | How it's known |
|---|---|---|
| **Dashboard** (blue) + **TEST** (amber) if it's test data | a row the dashboard created, or a test purge of one | the entry's saved snapshot has `origin: "dashboard"`; TEST when `is_test: true` |
| **Dynamics** (grey) | a synced row removed by reconciliation approve-delete | `changes.approved_via = "deletion-reconciliation"`; the sweep only ever acts on `origin='dynamics'` rows |
| *(none)* | dashboard-owned tables: account teams, client status, saved views, permissions, financials | no origin in the entry |

The badge is worked out server-side (`originOf` in `lib/audit-log/labels.ts`) from data each entry already holds. **No SQL or data change was needed.**

**Record resolution** does not keep a list of which entities are account-keyed — a list that would go stale the next time a write surface is added. It asks whether the id *starts with* a uuid that happens to be a known account, which covers `account_status`, `client_todo_notes`, `accounts.ai_summary`, the `<account_id>|<role>` team ids, and a reconciliation delete of an `accounts` mirror row alike.

### Filters

**Actor · Entity · Action · From / To**, all applied **server-side** and combinable, all living in the URL so a filtered view is shareable. Plus a **keyword box** over Record and Summary — the one filter that stays in the browser, because both are derived strings rather than indexed columns.

The row count reflects the active filters, and the header says which window you are looking at ("last 30 days", "custom range", "all time", "full history").

Entity and Action need no query — both are closed sets the code knows. The **Actor** list is a capped distinct scan fetched *after* the table paints. The CRM pages use a dedicated `*_filter_options` view for this, which is the right pattern here eventually; it was not worth another pending patch for a table with zero rows. **When the log passes ~20,000 rows**, add `v_admin_audit_filter_options` — the call site does not change shape.

### History for one record

`?entity=<entity>&record=<record_id>` pins the view to one thing's full timeline. It **flips the sort to chronological** (reading a history backwards is the wrong way round) and **ignores the date window**, since the point is to see the whole life of the record.

Reachable from the drawer's **"View full history for this record"** button — so from one account-team change you can get to every change that slot has ever had, oldest first.

### The drawer

Row click opens a slide-in with the full entry: the origin badge beside the action pill, When, Actor (+ the view-as note, spelling out that the actor shown is the **real** person), Action, Entity, Record (with client name), Where, and the complete `changes` as a field-by-field **old → new** table. Creates and deletes show the row snapshot instead.

The diff is **rendered server-side** by `loadAuditRecord`, which resolves every uuid to a person or client name before it reaches the browser — so the page never ships the accounts and users lookups just so a drawer can read well.

### Performance

Same shape as the CRM tables, because an audit trail only grows:

- **The list query never selects `changes`.** It is a jsonb blob per row and the list shows one line of it. The summary is built server-side from a second, keyed fetch covering only the rows being displayed; the browser receives short strings.
- Virtualized body (30px rows, spacer rows above and below), sticky header.
- Default window **30 days**, newest first; capped at **2,000** rows with a "showing first N of M" notice. **All time** is one click.
- The date window uses the `occurred_at DESC` index; a per-record history uses `(entity, record_id, occurred_at DESC)`.

### What it does not reuse

The saved-views machinery in `lib/table-views/`. That is built around an `EntitySpec` with its own `*_saved_views` table, column catalog and built-in presets — and this is an admin log with six fixed columns, not a working surface anyone curates views of. Wiring it in would have meant a sixth saved-views table for no benefit. The *visual and structural* patterns (virtualization, sticky header, drawer-as-sibling, URL-borne server-side filters) are reused directly.

### Column sorting

The headers are labels, not controls. A trail has one meaningful order — when it happened — and the server picks the direction (newest first, or oldest first in a per-record history). Re-sorting a log by entity would only hide the sequence.

## Where things live

| Concern | File |
|---|---|
| `recordAudit`, `diffRows`, `snapshot` | `dashboard/lib/audit.ts` |
| Table + append-only enforcement | `sql/patches/2026-09-15c_audit_log.sql` |
| Base DDL | `sql/02_rose_owned_tables.sql` |
| Viewer page (gate + list query + summaries) | `dashboard/app/admin/audit-log/page.tsx` |
| Viewer reads (drawer record, actor list) | `dashboard/app/admin/audit-log/actions.ts` |
| Viewer table + filters + drawer | `dashboard/app/admin/audit-log/audit-log-view.tsx` |
| Entity/field labels, diff rendering, record resolution | `dashboard/lib/audit-log/labels.ts` |
| Route gating | `dashboard/lib/access-control.ts` (`ADMIN_ONLY_ROUTES`) |
