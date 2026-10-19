# 14 — Tasks (all CRM)

> **Status: built, SQL PENDING.** The page is at `/tasks`, reached from the **CRM** block at the bottom of the main nav rail, inside its collapsible **Actions** submenu (super-user-only).
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

**One narrow exception (2026-10-19):** `loadTaskRecord` also returns a **Marketing Memo** task to **its owner**, one task at a time, so the teaser can upload the memo document from My Dashboard. It checks on the server that the sub-type is Marketing Memo and the owner is one of the caller's CRM ids. No list, no Edit. See [Marketing Memo document](#marketing-memo-document-2026-10-19).

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

### Close from the card (2026-10-08)

The task card (drawer — CRM → Tasks, My Dashboard, Feedback Reports) has a **Close** button next to **Edit**. One click arms it (**Confirm close** / Cancel) — a guard against accidental closes; there is no undo because a close can fire automations (e.g. closing a Feedback task creates its review task) that an undo could not reverse. It is the action only — no form loads.

- **Feedback-type tasks are different (2026-10-15):** closing a **Feedback** task or a **Feedback Report Sent** task here, or completing one via Edit, runs the **feedback close rules**, not the generic one. Feedback needs someone assigned, then the assignee or Super User / Admin. Feedback Report Sent allows the owner, the client's account team, or Super User / Admin. `closeTask` hands these to `closeFeedbackTask` / `closeFeedbackReview`; `updateTask` runs the same checks before saving. See [27 — Feedback reports → Feedback close rules](27-feedback-reports.md).
- **Who (every other task):** the task's **owner** (`owner_id` ∈ your CRM ids) or an **admin** (super user); never in "View as". The button shows only when you may; `closeTask` (`app/tasks/actions.ts`) re-checks everything on a fresh read (`decideTaskClose`, `lib/tasks/close.ts`) and refuses anyone else with "Not authorised". Guarded update: still Open, same origin, not closed yet — exactly one row. Audited.
- **What it writes — the existing completion workflow, no parallel status:**
  - **Dashboard-origin:** state/status **Completed** + `actual_end` = now (the same fields as Edit → Status: Completed and Feedback Reports → Close), so triggers and views react as to any completion; plus the sidecar below.
  - **Dynamics-origin (pre-cutover):** **only the dashboard-owned sidecar** — `closed_by_id`, `closed_by_name`, `closed_at` (the 2026-10-07 columns the sync never writes). The task stays Open in the mirror; the card shows a green *Closed by … · Dynamics update at cutover* pill, and **My Dashboard treats it as closed** (Other Open Tasks, Reports · Open / Claimed and the nav badge leave it out — `loadSidecarClosedTaskIds`). CRM → Tasks still lists it as Open until cutover.
- **Afterwards:** a toast, the page refreshes (the originating list drops it, counts update), and the card reloads showing its closed state.
- **Cutover step — native write-through:** flip `TASK_CLOSE_WRITE_THROUGH_DYNAMICS` in `lib/tasks/close.ts` so Dynamics-origin closes also write the native completion fields, and write through the ones closed before the flip: `origin = 'dynamics' AND state_label = 'Open' AND closed_at IS NOT NULL`.

### Marketing Memo document (2026-10-19)

A **Marketing Memo** task's drawer has a **Memo document** field at the top. The task's owner (the teaser) uploads the memo's Word document there, and it's pushed to SharePoint.

- **Who:** the task's **owner** (`owner_id` ∈ your CRM ids) or a **Super User / Admin**, never in "View as" (`canUploadMemo`, `lib/tasks/memo-file.ts`). Everyone else who can open the task sees the link read-only. Works on dashboard- **and** Dynamics-origin memo tasks; it writes only dashboard-owned columns.
- **Owners can now open their memo tasks.** The task drawer was super-user only; `loadTaskRecord` now also lets in the **owner of a Marketing Memo task**, so a teaser without CRM → Tasks access can click the task in **My Dashboard → Other Open Tasks** (`TaskItem.ownMemo`) and upload. That owner-only view has **no Edit** (`can_edit` false; `updateTask` is still CRM-writer only). Every other task and loader is unchanged.
- **File:** **.doc / .docx only**, **4 MB** max, checked in the browser and again on the server. The file keeps **its own extension** (a `.doc` renamed `.docx` wouldn't open).
- **Name:** the **task name** (subject), sanitized for SharePoint (`memoFileName`): `" * : < > ? / \ | # %` and control characters become `-`, repeated spaces and dashes collapse, a leading `~$` and trailing dots / spaces are dropped, and it's capped at 200 characters. Example: *Marketing Memo – ZVZZT - Boston - 10-6, 10-7.docx*.
- **Where:** the **Documents library root** of `https://rosecoglobal.sharepoint.com/sites/CRMDocuments` (folder constant `CRM_DOCUMENTS_FOLDER` in `lib/graph/sharepoint.ts`, "" = root).
- **Re-upload / name clash:** a re-upload on the **same task** writes a **new version** of its stored file (by item id; the SharePoint name is kept even if the subject changed since). If that file was deleted in SharePoint, it uploads afresh. A **first** upload whose name is already taken by another file is **auto-renamed** by SharePoint (*name 1.docx*), so another task's memo is never overwritten.
- **Stored on the task:** `memo_file_item_id`, `memo_file_web_url`, `memo_file_name`, `memo_file_uploaded_at`, `memo_file_uploaded_by_id` / `_name`, from **`sql/patches/2026-10-19_task_memo_file.sql` (run it first)**. Until it's run the field says *"Document upload isn't switched on yet"* and the upload refuses before sending anything. After upload the field shows the file as a link (opens in SharePoint) with who uploaded it and when. Audited (`/tasks · Marketing Memo upload`).
- **Errors are shown, never swallowed** (toast + inline): a Graph **401 / 403** says the SharePoint permission isn't granted yet (below); 404 = site / library not found; 409 / 423 = the file is locked or checked out; 5xx = try again; missing Graph credentials say so. If the upload worked but saving the link failed, the message says the file *is* in SharePoint.
- **Graph permission it needs:** write access to the CRMDocuments site for the Graph app, `Sites.Selected` plus a site grant. See [05 — Sync & Integrations → Graph permissions](05-sync-and-integrations.md#graph-permissions).
- **Size limit plumbing:** server actions default to a 1 MB body; `next.config.ts` raises it to 4.5 MB (`experimental.serverActions.bodySizeLimit`), which is also Vercel's request cap. Larger memos would need a Graph upload session (not built).
- Code: `app/tasks/memo-upload-actions.ts` (`uploadMarketingMemo`), `app/tasks/task-record-pane.tsx` (`MemoDocumentField`), `lib/tasks/memo-file.ts` (pure rules, unit-tested), `lib/tasks/memo-file-server.ts`, `lib/graph/sharepoint.ts`.

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
- **Row height is 32px** (`CRM_TABLE_DENSITY.rowHTwoLine`; 34px before the 2026-10-10 compact pass), not the shared 30px, because the Regarding cell stacks a name over a small type label. `ROW_H` must match the rendered height exactly or the virtualisation spacers drift out of step with the scroll position.

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


---

## Create & edit (dashboard records)

**Add New Task** and the drawer's **Edit** button (dashboard-created records only; Dynamics records stay read-only until cutover) use **one form that covers every field the drawer shows**, grouped the same way. That's the "form field set = drawer field set" principle; see [22 — Cutover](22-cutover-ownership-boundary.md). Created / modified by and on are display-only system fields. No field on this drawer is read from `_raw`, so **no columns needed flattening**.

**Editable:** client, subject, description, type & sub-type, priority, status, due, **scheduled start**, **actual start / end**, **% complete**, regarding (client or event), **event**, owner, **claimed by**, **current assignment**, **outreach task status**, and the six **workflow flags** (Drafting, Draft Complete, Review Complete, Processed, Feedback Received, Notified).

**Derived:** State follows status, and Regarding Type follows regarding.

**Required fields (2026-10-12):** **Subject**, **Task Type** and **Task Subtype** (marked with a red \*). On a new task, Type and Subtype start blank, so they have to be picked on purpose, and the Subtype list only opens once a Type is chosen. Changing the Type clears the Subtype. Saving with any of these empty is blocked and the field shows an inline error. The rule lives in one place, `validateTaskRequired` in `lib/tasks/create.ts` (tested in `create.test.ts`): the form calls it before submitting, and `buildTaskColumns` in `app/tasks/actions.ts` calls it again on the server. **Client is optional** and is never enforced. A task with no client is saved with no client (`bcs_account_id` null) and no Regarding (`regarding_*` null), and can't be linked to an event. Before this change the form and the server both required a client.

**People pickers: Rose & Co active personnel (2026-10-12).** **Owner**, **Claimed By** and **Current Assignment** use the same list as the Meeting form's Host / Booker pickers: `loadTaskUserOptions` → `loadPersonnelOptions` in `lib/crm-write.ts`. That is active, *human* `public.users` rows, one per person; see [12 — Meetings → People pickers](12-meetings-all.md). Before this they listed every `is_active` row, including service accounts and outside users. People already on a task being edited stay in the list (marked "(inactive)" if disabled), so historical assignments aren't blanked. The server enforces the same rule with `requireActivePersonnel` in `buildTaskColumns`: a newly picked person must be active personnel, but a value already stored on the task may stay. A blank Owner still defaults to the person saving.

**Client picker = active clients only (2026-10-12).** It uses `loadTaskClientOptions` → `loadActiveAccountOptions` in `lib/crm-write.ts`, the shared `accounts.state_label = 'Active'` rule used by the Event, Meeting, Note and Touchpoint forms. An edited task, or a Client Detail quick-add, keeps its own client in the list even if that client has since gone inactive, so a historical value is never blanked. This is a picker scope only. Client is still **optional** on tasks.

**Layout:** the form is the large, two-column dialog used for events and meetings (`max-h-[92vh] w-[96vw] sm:max-w-[1080px]`). Column 1 has *Task* and *Dates & Progress*; column 2 has *People*, *Workflow* and the Test toggle. Below the `lg` breakpoint it collapses to one scrolling column. Only the field area scrolls; the header and footer stay fixed.

### Feedback Received Date: the field that drives the feedback pipeline
**Feedback Received Date** (`crdfa_feedback_received_date`, a real synced column) is now in the task drawer and on the create/edit form (Workflow group). It's what `v_feedback_pipeline` uses: a **Feedback** task with **Status = Open** and this date set is in the pipeline's **Open** bucket. Completing the task moves it on to **Pending Review** (while its paired "Feedback Report Sent" task is still open). No flattening or view change was needed.

The older **Feedback Received** checkbox (`bcs_feedback_received`) is now labelled **"(legacy, info only)"**. The pipeline stopped using it on 2026-09-09 because it was unreliable, so ticking it changes nothing downstream.

## Feedback claiming (Feedback Reports → Claim / Release / Reassign / Close)

### What it does (plain language)

On **Logistics → Feedback Reports** (`/feedback-manager`), a Feedback task can now be **claimed**: a person with the **Claim feedback** permission clicks **Claim** and becomes its owner. The task stays **Open** — it's just theirs now. The owner (or an admin) can **Release** it back to unclaimed; an **admin** (Super User) can **Reassign** it to anyone, or **Assign** an unclaimed one; and the owner (or an admin) can **Close** it at any time, which completes the task and moves the report on to **Pending Review** — exactly as completing it in the CRM does. Every change is recorded in a claim history and the audit log.

The Open section's filter is now **All · Unclaimed · Mine · Claimed by others · Closed**. Claimed rows show the owner with a "since" date; **Closed** lists the tasks closed here (owner, who closed it, when). Buttons update the row instantly and confirm with a toast; if the server refuses, the row snaps back and the toast says why.

**Scope today:** only **dashboard-created** Feedback tasks (`origin = 'dashboard'`) that are **Open** and have a **Feedback Received Date** are claimable. Feedback tasks synced from Dynamics show as before, with no buttons, until cutover. Dashboard events now get their Feedback report automatically, and closing one creates its Pending Review task — see [27 — Feedback reports](27-feedback-reports.md).

> **Run first:** `sql/patches/2026-10-07_feedback_claims.sql`. Until it has run, the page works as before and shows admins a "switched off until the patch is run" note; the Admin → Users "Claim feedback" box refuses to turn on.

### The permission — "Claim feedback"

> **2026-10-16:** Claiming is now grantable per **role** (Admin → Roles, key `data:claim_feedback`) as well as per person. A second capability, **Mark feedback received**, lets a person mark a report's feedback all in and **assign / release / reassign** Feedback tasks. Release and reassign are now open to the admin, the task's **current owner**, or a holder of Mark feedback received. Close stays owner / admin only. The table below is the earlier state; see [27 — Feedback reports → Feedback permissions](27-feedback-reports.md#feedback-permissions-2026-10-16).

| Who | Claim | Release | Reassign / Assign | Close |
|---|---|---|---|---|
| Has **Claim feedback** (Admin → Users) | an unclaimed task | their own | — | their own |
| **Super User** (admin) | ✓ (always, no box needed) | any | any | any **assigned** task |
| Everyone else | — (no button; refused server-side) | — | — | — |

- **Close guard (2026-10-15):** a Feedback task can't be closed until someone is assigned, admins included. `decideClose` refuses with *"Assign before closing."* and the Close button is disabled with that tooltip.
- **Owner follows the claim (2026-10-15):** Claim and Reassign also set the task's `owner_id` / `owner_name` to the assignee; Release clears them.
- **Shared with the event card:** these buttons are one component, `ClaimActions` (`app/feedback-manager/claim-actions.tsx`). The event drawer / Edit Event lifecycle card uses the same component with the same server actions, so permissions match exactly. See [27 — Feedback reports → Report lifecycle](27-feedback-reports.md#report-lifecycle--event-drawer-card-2026-10-15).

- Stored as `user_data_scopes.claim_feedback` (default **off**), read through `getUserScopes()` → `scopes.claimFeedback`; Super Users are granted in code. Toggled on **Admin → Users** next to Financials; scope-checkbox saves are now **audited** (`entity = user_data_scopes`).
- ~~It's a per-person capability only (no Roles-matrix row).~~ Since 2026-10-16 it is also a Roles-matrix data permission (`data:claim_feedback`); both halves are read by `loadFeedbackCapabilities`.
- **"View as"** previews the buttons but disables them; the server refuses every claim action while impersonating.

### The data — dashboard-owned, sync-safe

New columns on `public.tasks`: `claimed_by_id`, `claimed_by_name`, `claimed_at`, `closed_by_id`, `closed_by_name`, `closed_at`. The Dynamics sync **never writes them** — `mapTask` (`lib/sync/mappers.ts`) doesn't emit them, and the sync upsert only sets the columns it sends — so they survive every sync run. That's what lets the same mechanism cover Dynamics-origin tasks at cutover.

On dashboard-origin rows the claim actions also keep the existing **`bcs_claimed_by_id` / `bcs_claimed_by_name`** in step, so every current reader shows the claim with **no view change**: `v_feedback_pipeline` (Feedback Reports' Claimed By, the KPI flow, workload strip), the Alerts page and nav badge, **My Dashboard's "open feedback report I've claimed"**, and the Tasks page. (The Tasks form's own "Claimed by" field still writes only the `bcs_` field; the claim actions treat that as the owner when `claimed_by_id` is empty.)

Claim history: `public.feedback_claim_events` — one append-only row per claim / release / reassign / close (task, from → to owner, the real acting person, when). Each action also writes an `audit_log` entry (`entity = tasks`, `context = feedback-claim:<event>`).

### How Close drives the existing completion workflow

Close sets the task's **native completion fields** — `state_code 1 / state_label 'Completed'`, `status_code 5 / status_label 'Completed'`, `actual_end = now` — the same values Tasks → Edit uses for "Completed" (`TASK_STATUS_OPTIONS`), plus `closed_by_*` / `closed_at`. `v_feedback_pipeline` then does the rest on its own: the Feedback task leaves **Open** and, while its paired *Feedback Report Sent* task is still open, appears in **Pending Review** with `fb_closed_date = actual_end`. Nothing else in the review / send flow changes. Since 2026-10-07b the close also **creates the review task automatically** ("Feedback Report Pending Review – <event>", linked to that exact report), so a dashboard report always lands in Pending Review — see [27 — Feedback reports](27-feedback-reports.md).

### Server-side checks (`app/feedback-manager/actions.ts`)

Every action: refuse "View as" → re-read the task → apply the pure rules (`lib/feedback-claims/policy.ts`, unit-tested) → a **guarded UPDATE** whose WHERE repeats the pool (Feedback, Open, origin) and the owner it read, and must change exactly one row (so two people racing to claim can't both win) → history + audit → refresh Feedback Reports, My Dashboard and Alerts. Errors come back as the app's standard "not authorised / why" result shown in a toast.

**Origin edit-guard:** these actions deliberately do **not** use `lib/crm-write.ts` (`requireCrmWriter` / `updateDashboardRow`) — that is the generic super-user-only "edit a CRM record" gate. Claiming is gated on the **capability**, never on the generic guard. The pool's origin rule lives in the claim policy instead.

### Cutover (Dynamics-origin feedback tasks)

- **Today (pre-cutover):** `FEEDBACK_CLAIMS_INCLUDE_DYNAMICS = false` in `lib/feedback-claims/policy.ts`. Dynamics-origin Feedback tasks are not claimable and nothing writes to them.
- **At cutover** (direct editing of Dynamics-origin records allowed): set that constant to **`true`**. That is the only code change — Dynamics-origin Feedback tasks enter the pool, and the same actions write the same dashboard-owned columns and, on Close, the same native completion fields.
- **Cutover checklist:** (1) the task sync must stop overwriting Dynamics rows (otherwise the next sync re-opens a closed task and resets `bcs_claimed_by_*`; the `claimed_*` / `closed_*` columns survive regardless); (2) if the sync keeps running, point `v_feedback_pipeline`'s `claimed_by_*` at `tasks.claimed_by_*` instead of `bcs_claimed_by_*`; (3) optionally backfill `claimed_by_*` from `bcs_claimed_by_*` so existing CRM claims carry over.
