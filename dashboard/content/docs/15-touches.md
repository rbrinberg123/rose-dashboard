# 15 — Touches (all CRM)

> **Status: built, SQL PENDING.** The page is at `/touchpoints`, reached from the **CRM** block at the bottom of the main nav rail (super-user-only).
>
> **`sql/patches/2026-09-15_admin_touchpoints.sql` has not been run yet.** Until it is, the page loads and gates correctly but shows "Could not load saved views" with the patch filename — it fails soft, it does not crash. The patch creates `v_admin_touchpoints_all`, `v_admin_touchpoints_filter_options`, `touchpoint_saved_views` and six indexes. The same objects are also in the base files (`sql/01_mirror_tables.sql`, `sql/02_rose_owned_tables.sql`, `sql/03_views.sql`).
>
> **Not yet pushed to any remote.** The application code is local-only.

> **"+ Add New Touch" is a placeholder.** The button top-right of the masthead — and the matching entry in the nav's CRM quick-add menu — create nothing yet. No form, no write, no navigation: clicking shows a "Coming soon" toast. Both route through the single stub `onAddNew("touch")` in `dashboard/components/crm-add-new.tsx`, staged for the CRM cutover. See [02 — Pages](02-pages.md#add-new-buttons-and-the-quick-add-menu--placeholders-not-wired-up).

## Naming: "Touches" on screen, "touchpoints" underneath

The page is called **Touches** everywhere a person sees it — the nav rail label, the page and browser-tab title, the built-in view names ("Recent touches", "All touches"), the `Touch` column band, the drawer's `Touch` section and header, and the Excel export (sheet **Touches**, file `crm-touches_<date>.xlsx`).

**Every internal name is still `touchpoint(s)`**, deliberately, so nothing in the data layer had to move:

| Stays as-is | |
|---|---|
| Route | `/touchpoints` |
| Views | `v_admin_touchpoints_all`, `v_admin_touchpoints_filter_options` |
| Tables | `public.touchpoints`, `public.touchpoint_saved_views` |
| Indexes | `idx_touchpoints_*` |
| Code | `TOUCHPOINTS_SPEC`, `AdminTouchpointRow`, `TouchpointsView`, `app/touchpoints/*`, `lib/touchpoints/*` |
| URL params | `?client=`, `?type=`, `?contact=`, `?by=`, `?status=` |

This was a **display-label change only**. Saved views survive it: a built-in view is keyed by its `id` (`builtin:recent`, `builtin:all`), not its name, so renaming the labels does not orphan anyone's default.

## What it is

Every logged client contact in the CRM, in one table — the fourth CRM feature, built on the same machinery as [12 — Meetings](12-meetings-all.md), [13 — Events](13-events.md) and [14 — Tasks](14-tasks.md). Saved views, the column picker, the filter builder, quick-filter dropdowns, the detail drawer, the row cap and the Excel export are all the *same code*, parameterised per entity. See [Shared architecture](#shared-architecture).

**`public.touchpoints` is the mirror of the Dynamics `phonecall` entity** (`lib/sync/entities.ts` maps `phonecalls` → `touchpoints`), relabelled because Rose logs *all* client contact as one — most touches are not phone calls:

- **Every type.** Virtual (946 of 1,141 live rows), Email (94), In-Person (71), Social (10), Onboarding Call (9), Teach-in (4), unset (7).
- **Every state.** Open (1,090), Completed (51).
- **Two and a half years.** `scheduled_start` spans 2024-05-03 to 2026-09-15; 645 rows fall in the rolling last-12-month window.
- **No row scoping.** `v_admin_touchpoints_all` is unscoped; every client's touches are returned to whoever loads the page — **including the free-text call notes**, which are the most sensitive field on the record (present on 93% of rows, often several paragraphs).
- **View only.** Nothing is editable and nothing writes back — Dynamics is the system of record.

## Security

Identical to the other three CRM pages, and for the same reason: the page reads an unscoped view through the service-role client, which bypasses RLS. Three independent gates:

1. **`lib/access-control.ts` `ADMIN_ONLY_ROUTES`** now holds `/meetings`, `/events`, `/tasks` **and** `/touchpoints` — super-user-only, and **not** grantable to another role through the Admin → Roles matrix. Checked *after* the super-user backstop and *before* the matrix lookup, so a stray `role_page_access` row cannot open it.
2. **`proxy.ts`** runs `canAccessRoute` before the page renders.
3. **`app/touchpoints/page.tsx`** re-checks the **effective** role server-side before it builds any query — a page is not the only way in, so it does not assume the proxy ran.

Every server action in `app/touchpoints/actions.ts` re-checks too, because a server action is its own entry point and can be invoked directly.

The nav entry is gated by `canSeeCrmNav`, which requires **both** `role === "super_user"` **and** `canAccessRoute`. For a non-super-user the whole CRM block is absent from the DOM — no item, no divider. Covered by `lib/nav-crm.test.ts`, which asserts the rule for every role in the system and for every item in the block, including a case where the matrix explicitly grants `/touchpoints` and it is *still* denied.

## The seven list columns

Everything else in the catalog is **available-but-hidden**, so a saved view can add it without a code change.

| # | Column | Source (`v_admin_touchpoints_all`) | Notes |
|---|--------|------------------------------------|-------|
| 1 | **Client** | `client_account_name` + `accounts.ticker_symbol` | Shows the **ticker** (full name on hover), **links** to `/client-detail?account_id=…`. 1,116 of 1,141 rows resolve a ticker; 25 carry no account and are kept by the LEFT JOIN |
| 2 | **Date** | `scheduled_start` → `touchpoint_date` | The touch's own date. 99% populated |
| 3 | **Subject** | `subject` | **The row's handle** — click to open the drawer. 675 distinct values |
| 4 | Type | `touchpoint_type_label` | Virtual / Email / In-Person / Social / Onboarding Call / Teach-in |
| 5 | Contact | `contact_type_label` | **A role, never a name** — see [No contact person](#there-is-no-contact-person) |
| 6 | Status | `status_label` | Coloured pill: Open / Made / Received |
| 7 | Created By | `created_by_name` | Circle avatar. **The real person on the record** — see [Owner is a team](#owner-is-a-team-not-a-person) |

**Available but hidden** (add via *Edit columns*): Notes, Direction, State, Owner Team, Modified By, Created, Modified, Scheduled End, Duration, Last 12 Months, the raw ticker, Regarding Id and the five raw option-set codes.

Four are hidden **on purpose** rather than for lack of room — all four are constants or duplicates on live data, and a constant column earns no width:

| Hidden column | Why |
|---|---|
| **Direction** | `direction_code` is `true` on all 1,141 rows → "Outgoing" always |
| **Owner Team** | duplicates Client (see below) |
| **Duration** | `actual_duration_minutes` is `30` on every populated row |
| **Scheduled End** | identical to Date on every row |

### Column groups

Five bands, in picker order: **Client · Touch · Classification · People · System**. A band is a run of *adjacent* columns, so the default column order is what decides where the rules fall.

## Default view: Recent touches

A **rolling last-12-months** window — **645 of 1,141** rows — sorted by date **descending**. This is a historical **log**, like Meetings and Events and unlike Tasks' worklist, so the interesting end is the recent past. `nullsFirst: false` puts the 8 undated rows at the bottom.

### Why `is_recent` and not a date filter

The shared filter grammar resolves only `$today`, `$tomorrow` and frozen `YYYY-MM-DD` literals (`resolveDateValue` in `lib/table-views/query.ts`). There is no relative-offset token, so a saved filter of `touchpoint_date after 2025-09-15` would be correct on the day it was written and quietly wrong forever after — **the window would never move**.

So the window is computed in the **view** instead:

```sql
(t.scheduled_start >= (now() - interval '12 months')) AS is_recent
```

and the built-in view filters `is_recent isTrue`. That keeps the default genuinely rolling, re-evaluated on every query, and needs no change to machinery three other pages depend on. The cost is one boolean column; the alternative was a new token in the shared date resolver. `is_recent` is exposed as a hidden column ("Last 12 Months") so anyone auditing why a row is or is not in the default view can see it.

The other built-ins: **Recent — Virtual**, **Recent — In-Person**, **Completed** and **All touches**. They are code, not rows, so they always exist and need no seeding step.

## The detail drawer

Slides in from the right as a **sibling** of the list, never wrapping it, so opening a record cannot remount the table — which is what keeps the scroll position and the virtualisation window intact.

**Header:** the Subject as the headline (wrapping to at most two lines rather than truncating), then a `Type · Contact Type` pill and a Status pill.

**Four sections**, rendered from field definitions in `lib/touchpoints/record.ts`, not from hand-written JSX:

| Section | Fields |
|---|---|
| **Touch** | Subject, Notes, Type, Date, Direction, Status, State, Duration |
| **Client & Contact** | Client (linked), Contact Type |
| **People** | Created By, Modified By, Owner Team |
| **System** | Created On, Modified On, Scheduled End |

The Notes field is full-width and preserves line breaks — it is the substance of a touch, and the only place it is shown (it is never a list column).

### Field-sourcing notes

Three fields on this entity are **not what their Dynamics names suggest**. The view renames them to say so, and the measurements behind each are in the patch header.

#### Owner is a team, not a person

In `_raw`, `_ownerid_value@Microsoft.Dynamics.CRM.lookuplogicalname` is the literal string **`"team"`** on every row, and the formatted value is the **client's** name: this CRM owns each phonecall by a per-account team named after the account.

Measured: `owner_name` has **142 distinct values, all of them account names**; it equals `client_account_name` on 375 of 400 sampled rows; and **none** of 20 probed `owner_id`s resolves to a `public.users` row.

So the column is exposed as **`owner_team_name`** — named for what it is — and is hidden by default. **There is no Owner dropdown**, because it would be a second, worse copy of the Client dropdown. The real person is **Created By** (23 distinct staff, 100% populated), which takes that slot instead.

This is the one place the page deliberately departs from the brief, which asked for a Client / Type / **Owner** filter set.

#### There is no contact person

The brief asked for contact/investor. **It does not exist in this entity.** `regarding_id` is the **account** on 399 of 400 sampled rows (`_regardingobjectid_value@…lookuplogicalname` = `"account"`), there is no contact lookup, and the sync does not expand the `activityparty` collections — so the `from`/`to` party lists are **absent from `_raw` entirely**.

The closest available field is **`contact_type_label`**: *which role* was spoken to, not who. IRO (419) / Other (48) / CEO (18) / CFO (16) and combinations. It is a **multi-select stored semicolon-joined** ("CFO; IRO"), 13 distinct combinations, populated on 49% of rows. The filter dropdown offers each whole combination as its own choice, because that is what the column literally holds and `eq` has to match it exactly.

Sourcing a real contact name would need a sync change to expand the activityparty collections — it is not recoverable from the data as mirrored today.

#### Modified By comes from `_raw`

The mirror flattens `created_by` but **not** `modified_by`, and the drawer wants both. `_modifiedby_value` and its formatted value are **100% present in `_raw`** (17 distinct people), so the view digs them out:

```sql
NULLIF(btrim(t._raw ->> '_modifiedby_value@OData.Community.Display.V1.FormattedValue'), '')
```

This is the **only** `_raw`-sourced pair here; everything else is a real column. Because the view does the digging, `_raw` is still never selected by the list *or* the drawer.

#### Empty or constant, and exposed anyway

`direction_label` is derived from `direction_code` (constant `true` → "Outgoing") so an inbound row would render correctly if one ever arrived. These `_raw` fields are **0% populated** across all 1,141 rows, so nothing is sourced from them: `phonenumber`, `bcs_calldisposition`, `category`, `subcategory`, `actualstart`, `senton`, `_bcs_mastercompany_value`, `_createdonbehalfby_value`.

### Edit-ready, deliberately not editable

Every field comes from `TOUCHPOINT_SECTIONS` in `lib/touchpoints/record.ts` as `{ label, sourceKey, type }`, rather than hand-written markup per field. That is what makes turning this into a real editor a **localised** change: swap the read-only renderer for an input keyed off `type`, add form state, add a save action. The sections, labels and ordering do not move.

Do **not** add editing without the dashboard actually becoming the system of record. Today Dynamics is, and everything in this app is read-only.

## Saved views and filters

Identical to the other three, on the shared implementation in `lib/table-views/saved-views.ts` — **one** module enforces the rules for all four entities, so there is no second place for the authorisation to be wrong.

- **System views** — visible to everyone who can reach the page; only a super-user may create, rename or delete one.
- **Personal views** — per-login, visible only to their owner.
- **One default each**, enforced by partial unique indexes in the database (`touchpoint_saved_views_one_personal_default`, `..._one_system_default`).
- Resolution order when the page opens: explicit `?view=` → the caller's personal default → the system default → the built-in fallback (**Recent touches**).
- Writes are refused while impersonating; the UI hides the save controls rather than offering a doomed click.

### Quick filters

Five dropdowns — **Client · Type · Contact · Created By · Status** — that sit *on top* of the active view's own filters and AND with them. They are deliberately **not** part of the view config: a saved view is a shape you return to, these are ad-hoc narrowing you apply and drop. They ride in their own URL params (`?client=`, `?type=`, `?contact=`, `?by=`, `?status=`), so they stay shareable and stay server-side.

All five land on indexed columns. Their choices come from `v_admin_touchpoints_filter_options`, where the distinct-ing is done in Postgres. The options are fetched by the **client after the table renders**: nothing on screen needs a dropdown's contents in order to paint a table.

**Created By is keyed by canonical user id.** Two people in this CRM carry duplicate Dynamics systemuser records, so filtering on one raw id would silently return part of that person's touches. The options view emits `public.canonical_user_id(created_by_id)` and `loadUserAliasGroups` expands it back to every id in the group — `IN (…)` is still a plain index scan on `idx_touchpoints_created_by_id`.

## Performance

The same shape as the other three CRM tables:

- **The list query selects only the display columns** — the active view's columns plus `alwaysSelect`. **`_raw` is never selected**, by the list or the drawer.
- **The drawer loads on demand.** One row when it opens, rather than shipping the multi-paragraph call notes for every row in the list. On this entity that is the single biggest saving available: the notes are 93% populated and never shown in the table.
- **Distinct filter values come from a dedicated view**, not a scan.
- **The unfiltered load is capped** at `ROW_CAP` (2,000) with a "showing first N of M" notice. At 1,141 live rows the cap does not bite today; it is there for growth. The **Excel export is not capped** — it re-fetches uncapped, *with the quick filters re-applied*, so the file always matches the active view. The export additionally forces `client_account_name`, `description` and `state_label` into the sheet, since the table shows a ticker and the notes are drawer-only.
- **Six new indexes.** `scheduled_start DESC` for the default sort (the pre-existing `idx_touchpoints_client` leads with `client_account_id` and cannot serve an unfiltered sort), plus `touchpoint_type_label`, `contact_type_label`, `created_by_id`, `status_label` and `state_label`.
- **Row height is 30px**, matching Events rather than Tasks' 34 — every cell here is a single line, with no stacked two-line cell. `ROW_H` must match the rendered height exactly or the virtualisation spacers drift out of step with the scroll position.

## Shared architecture

Nothing about filtering, validation, paging or authorisation is written again for Touches. The entity supplies a spec and a column catalog; everything else is the shared machinery:

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
| Route + server gate + list fetch | `dashboard/app/touchpoints/page.tsx` |
| Server actions (record, export, views, options) | `dashboard/app/touchpoints/actions.ts` |
| The table | `dashboard/app/touchpoints/touchpoints-view.tsx` |
| The detail drawer | `dashboard/app/touchpoints/touchpoint-record-pane.tsx` |
| Field definitions (drawer **and** catalog source) | `dashboard/lib/touchpoints/record.ts` |
| Column catalog, built-in views, `TOUCHPOINTS_SPEC` | `dashboard/lib/touchpoints/spec.ts` |
| Quick filters + user alias groups | `dashboard/lib/touchpoints/filters.ts` |
| Row type | `dashboard/lib/types.ts` (`AdminTouchpointRow`) |
| Route gating + nav item | `dashboard/lib/access-control.ts` |
| Nav icon (`MessagesSquare`) | `dashboard/components/nav.tsx` |
| SQL | `sql/patches/2026-09-15_admin_touchpoints.sql` |
