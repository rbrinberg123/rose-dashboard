# 14 — Tasks (all CRM)

> **Status: built, SQL PENDING.** The page is at `/tasks`, reached from the **CRM** block at the bottom of the main nav rail (super-user-only).
>
> **`sql/patches/2026-09-11_admin_tasks.sql` has not been run yet.** Until it is, the page loads and gates correctly but shows "Could not load saved views" with the patch filename — it fails soft, it does not crash. The patch creates `v_admin_tasks_all`, `v_admin_tasks_filter_options`, `task_saved_views` and six indexes.
>
> **Not yet pushed to any remote.** The application code is local-only.

> **"+ Add New Task" is a placeholder.** The button top-right of the masthead — and the matching entry in the nav's CRM quick-add menu — create nothing yet. No form, no write, no navigation: clicking shows a "Coming soon" toast. Both route through the single stub `onAddNew("task")` in `dashboard/components/crm-add-new.tsx`, staged for the CRM cutover. See [02 — Pages](02-pages.md#add-new-buttons-and-the-quick-add-menu--placeholders-not-wired-up).

## What it is

Every task in the CRM, in one table, with nothing hidden — the third CRM feature, built on the same machinery as [12 — Meetings](12-meetings-all.md) and [13 — Events](13-events.md). Saved views, the column picker, the filter builder, quick-filter dropdowns, the detail drawer, the row cap and the Excel export are all the *same code*, parameterised per entity. See [Shared architecture](#shared-architecture).

- **Every type.** Outreach (3,390 of 3,920 live rows), Advisory (498), Onboarding (18), Internal (12), Reminder (2).
- **Every state.** Open (530), Completed (3,345), Canceled (45).
- **No row scoping.** `v_admin_tasks_all` is unscoped; every client's tasks are returned to whoever loads the page.
- **View only.** Nothing is editable and nothing writes back — Dynamics is the system of record. The drawer is structured so that changes are a localised edit (see [Edit-ready](#edit-ready-deliberately-not-editable)).

## Security

Identical to Meetings and Events, and for the same reason: the page reads an unscoped view through the service-role client, which bypasses RLS, so a successful load hands the caller the firm's entire task history. Three independent gates:

1. **`lib/access-control.ts` `ADMIN_ONLY_ROUTES`** now holds `/meetings`, `/events` **and** `/tasks` — super-user-only, and **not** grantable to another role through the Admin → Roles matrix. Checked *after* the super-user backstop and *before* the matrix lookup, so a stray `role_page_access` row cannot open it.
2. **`proxy.ts`** runs `canAccessRoute` before the page renders.
3. **`app/tasks/page.tsx`** re-checks the **effective** role server-side before it builds any query — a page is not the only way in, so it does not assume the proxy ran.

Every server action in `app/tasks/actions.ts` re-checks too, because a server action is its own entry point and can be invoked directly.

The nav entry is gated by `canSeeCrmNav`, which requires **both** `role === "super_user"` **and** `canAccessRoute`. For a non-super-user the whole CRM block is absent from the DOM — no item, no divider. Covered by `lib/nav-crm.test.ts`, which asserts the rule for every role in the system and for every item in the block.

**Verified against the running app:** unauthenticated → `307` to `/login`; super_user → `200`; and `user`, `logistics`, `client_manager` and `associate` (through View-as) all → `307`. The `/tasks` link and the "CRM" label appear once for a super-user and zero times for a scoped user.

## The nine list columns

The order the brief specifies. Everything else in the catalog is **available-but-hidden**, so a saved view can add it without a code change.

| # | Column | Source (`v_admin_tasks_all`) | Notes |
|---|--------|------------------------------|-------|
| 1 | **Client** | `bcs_account_name` + `accounts.ticker_symbol` | Shows the **ticker** (full name on hover), **links** to `/client-detail?account_id=…` |
| 2 | **Subject** | `subject` | **The row's handle** — click to open the drawer |
| 3 | **Regarding** | `regarding_name` + `regarding_type_label` | Name over a small type label (Event / Client / Project / Contact) |
| 4 | Task Type | `bcs_task_type_label` | Outreach / Advisory / Onboarding / Internal / Reminder |
| 5 | Sub-type | `bcs_task_subtype_label` | 24 distinct values; Marketing Memo, Feedback and Targeting are the top three |
| 6 | Priority | *computed* — see [Priority](#priority-is-the-rose-field-first) | High / Normal / Medium |
| 7 | Due Date | `scheduled_end` | What the CRM treats as the due date. 98% populated |
| 8 | Owner | `owner_name` | Circle avatar for a real name; the raw code otherwise — see [Owner](#owner-is-not-always-a-person) |
| 9 | Status | `status_label` | Coloured pill: Not Started / In Progress / Completed / Canceled |

**Available but hidden** (add via *Edit columns*): Event, Created, Modified, Claimed By, Assigned To, Outreach Status, % Complete, Description, State, Scheduled Start, Actual Start, Actual End, Created By, Modified By, the six workflow booleans, Regarding Type, the two raw priority columns and the raw ticker.

### Column groups

Seven bands, in picker order: **Client · Task · Classification · Schedule · People · Workflow · System**. A band is a run of *adjacent* columns, so the default column order is what decides where the rules fall.

## Default view: Open tasks

`state_label = 'Open'` — **530 of 3,920** rows. That is what makes the page open on active work and open fast; the index `idx_tasks_state_due` serves the filter and the sort in one scan.

**Sorted by due date ASCENDING**, and this is the one place Tasks deliberately differs from Meetings and Events, which both open newest-first. Those two are historical logs, where the interesting end is the recent past. A task list is a **worklist**, and its question is "what is due next". `nullsFirst: false` puts the five undated Open tasks at the bottom rather than the top.

The other built-ins: **Open — Outreach**, **Open — Advisory**, **Completed** (newest-first) and **All tasks** (newest-first). They are code, not rows, so they always exist and need no seeding step.

## The detail drawer

Slides in from the right as a **sibling** of the list, never wrapping it, so opening a record cannot remount the table — which is what keeps the scroll position and the virtualisation window intact.

**Header:** the Subject as the headline (wrapping to at most two lines rather than truncating — half a task subject is not useful), then a `Task Type · Sub-type` pill and a Status pill.

**Four sections**, rendered from field definitions in `lib/tasks/record.ts`, not from hand-written JSX:

| Section | Fields |
|---|---|
| **Task** | Subject, Description, Task Type, Sub-type, Priority, Status, State, % Complete, Due, Scheduled Start, Actual Start, Actual End, Created On, Modified On |
| **Regarding & Links** | Regarding, Regarding Type, Client *(linked to client detail)*, Event |
| **People** | Owner, Created By, Modified By, Claimed By, Current Assignment — avatars where the value is a real name |
| **Workflow** | Outreach Task Status, then Drafting · Draft Complete · Review Complete · Processed · Feedback Received · Notified as Yes/No |

An empty value renders a quiet em dash, never a blank box — a gap in the CRM should read as a gap, not as a rendering failure.

### Field-sourcing notes

#### Priority is the Rose field FIRST

The brief said *"priority_label (fall back to `bcs_task_priority_label`)"*. Taken literally that produces a **constant column**: measured on all 3,920 live rows, `priority_label` is `'Normal'` on every single one and is never null, so `COALESCE(priority_label, bcs_task_priority_label)` can only ever return `'Normal'` and the fallback is unreachable.

The signal is in the Rose-specific field: `bcs_task_priority_label` is **High on 2,060** rows and **Medium on 24** (null on the remaining 1,836). So the precedence is **inverted on purpose**:

```sql
COALESCE(NULLIF(btrim(t.bcs_task_priority_label), ''), t.priority_label)
```

which yields **High 2,060 / Normal 1,836 / Medium 24** — a column worth showing. Both raw columns are exposed as well (`priority_rose_label`, `priority_stock_label`) so a saved view can filter either directly and nothing is hidden by the choice. If the literal reading was actually intended, swap the two arguments and the column becomes a constant again.

#### Owner is not always a person

`owner_name` carries three different kinds of value across its 22 distinct entries, and only **5 of the owner ids resolve to a `public.users` row**:

| Example | What it is | How it renders |
|---|---|---|
| `Katie Murphy` | a real person | initials circle, globally disambiguated (KMu / KMi) |
| `JS`, `YL`, `MB` | an already-abbreviated staff code | the code itself — `initialsOf("JS")` would render just **"J"**, which is wrong |
| `CRM`, `Feedback Reports` | a queue, not a person | shown as-is |

The rule (`isPersonName` in `lib/tasks/spec.ts`): a value containing a space is treated as a name and gets the shared avatar; anything else is a short code shown verbatim. That leaves `Feedback Reports` reading as a two-word name and taking an "FR" circle — harmless, and the alternative is hardcoding a queue list that would go stale the moment the CRM adds another.

#### Regarding type is translated

`tasks.regarding_type` holds raw Dataverse entity names — `bcs_event` (2,163), `account` (1,562), `bcs_project` (4), `contact` (1). `regarding_type_label` maps those to **Event / Client / Project / Contact**; the raw column is kept alongside it in the catalog.

#### Empty but real

**`actual_start` is 0% populated** across all 3,920 live tasks. It is exposed anyway because it is a field the brief asked for — it will fill in if the CRM starts writing it. `claimed_by_name` is 9% populated and `current_assignment_name` 41%; both are real, just sparse. The drawer footer says so rather than leaving a reader guessing.

### Edit-ready, deliberately not editable

Every field comes from `TASK_SECTIONS` in `lib/tasks/record.ts` as `{ label, sourceKey, type }`, rather than hand-written markup per field. That is what makes turning this into a real editor a **localised** change: swap the read-only renderer for an input keyed off `type`, add form state, add a save action. The sections, labels and ordering do not move.

Do **not** add editing without the dashboard actually becoming the system of record. Today Dynamics is, and everything in this app is read-only.

## Saved views and filters

Identical to Meetings and Events, on the shared implementation in `lib/table-views/saved-views.ts` — **one** module enforces the rules for all three entities, so there is no second place for the authorisation to be wrong.

- **System views** — visible to everyone who can reach the page; only a super-user may create, rename or delete one.
- **Personal views** — per-login, visible only to their owner.
- **One default each**, enforced by partial unique indexes in the database (`task_saved_views_one_personal_default`, `..._one_system_default`).
- Resolution order when the page opens: explicit `?view=` → the caller's personal default → the system default → the built-in fallback (**Open tasks**).
- Writes are refused while impersonating; the UI hides the save controls rather than offering a doomed click.

### Quick filters

Five dropdowns — **Client · Task Type · Sub-type · Owner · Status** — that sit *on top* of the active view's own filters and AND with them. They are deliberately **not** part of the view config: a saved view is a shape you return to, these are ad-hoc narrowing you apply and drop. They ride in their own URL params (`?client=`, `?type=`, `?sub=`, `?owner=`, `?status=`), so they stay shareable and stay server-side.

All five land on indexed columns. Their choices come from `v_admin_tasks_filter_options`, where the distinct-ing is done in Postgres — the dropdowns never scan 3,920 rows into the server process. The options are fetched by the **client after the table renders**: nothing on screen needs a dropdown's contents in order to paint a table.

**Owners are keyed by canonical user id.** Two people in this CRM carry duplicate Dynamics systemuser records, so filtering on one raw id would silently return part of that person's tasks. The options view emits `public.canonical_user_id(owner_id)` and `loadOwnerAliasGroups` expands it back to every id in the group — `IN (…)` is still a plain index scan on `idx_tasks_owner_id`. (Events has this machinery but never wired it; Tasks does.)

## Performance

The same shape as the other two CRM tables:

- **The list query selects only the display columns** — the active view's columns plus `alwaysSelect`. **`_raw` is never selected**, by the list or the drawer.
- **The drawer loads on demand.** One row when it opens, rather than shipping the description and the whole Workflow block for every row in the list.
- **Distinct filter values come from a dedicated view**, not a scan.
- **The unfiltered load is capped** at `ROW_CAP` (2,000) with a "showing first N of M" notice. The **Excel export is not capped** — it re-fetches uncapped, *with the quick filters re-applied*, so the file always matches the active view.
- **Six new indexes** (`sql/patches/2026-09-11_admin_tasks.sql`): `(state_label, scheduled_end)` for the default view and its sort, plus `state_label`, `scheduled_end`, `bcs_task_type_label`, `bcs_task_subtype_label` and `owner_id`. Note the pre-existing `idx_tasks_task_type` is on the `_code` column, which cannot serve a filter on the label.
- **Row height is 34px**, not the Events table's 30, because the Regarding cell stacks a name over a small type label. `ROW_H` must match the rendered height exactly or the virtualisation spacers drift out of step with the scroll position.

## Shared architecture

Nothing about filtering, validation, paging or authorisation is written again for Tasks. The entity supplies a spec and a column catalog; everything else is the shared machinery:

| Piece | Where |
|---|---|
| Entity contract, field types, operators | `lib/table-views/types.ts` |
| Config validation + default resolution | `lib/table-views/config.ts` |
| Query builder, paging, row cap, filter options | `lib/table-views/query.ts` |
| Saved-view read/write + authorisation | `lib/table-views/saved-views.ts` |
| Excel export | `lib/table-views/excel.ts` |
| Column picker / filter builder / dropdowns / switcher | `components/table-views/*` |

## Where things live

| Concern | File |
|---|---|
| Route + server gate + list fetch | `dashboard/app/tasks/page.tsx` |
| Server actions (record, export, views, options) | `dashboard/app/tasks/actions.ts` |
| The table | `dashboard/app/tasks/tasks-view.tsx` |
| The detail drawer | `dashboard/app/tasks/task-record-pane.tsx` |
| Field definitions (drawer **and** catalog source) | `dashboard/lib/tasks/record.ts` |
| Column catalog, built-in views, `TASKS_SPEC` | `dashboard/lib/tasks/spec.ts` |
| Quick filters + owner alias groups | `dashboard/lib/tasks/filters.ts` |
| Row type | `dashboard/lib/types.ts` (`AdminTaskRow`) |
| Route gating + nav item | `dashboard/lib/access-control.ts` |
| SQL | `sql/patches/2026-09-11_admin_tasks.sql` |
