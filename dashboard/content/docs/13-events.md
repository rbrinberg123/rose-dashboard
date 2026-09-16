# 13 — Events (all CRM)

> **Status: built, SQL deployed.** The page is at `/events`, reached from the **CRM** block at the bottom of the main nav rail (super-user-only).
>
> Both patches are live in Supabase as of 2026-09-10 — `sql/patches/2026-09-10_admin_events.sql` (list view, filter-options view, indexes, saved-views table) and `sql/patches/2026-09-10_admin_events_slots.sql` (the three capacity columns behind the [stat row](#the-capacity-stat-row), plus `idx_meetings_event_id`, which also speeds up Portfolio and Outreach Status). Verified against the live database: `v_admin_events_all` has 43 columns and the index is present.
>
> **Not yet pushed to any remote.** The application code is local-only.

> **"+ Add New Event" is a placeholder.** The button top-right of the masthead — and the matching entry in the nav's CRM quick-add menu — create nothing yet. No form, no write, no navigation: clicking shows a "Coming soon" toast. Both route through the single stub `onAddNew("event")` in `dashboard/components/crm-add-new.tsx`, staged for the CRM cutover. See [02 — Pages](02-pages.md#add-new-buttons-and-the-quick-add-menu--placeholders-not-wired-up).

## What it is

Every marketing event in the CRM, in one table, with nothing hidden. It reproduces the Dynamics **"Current and Upcoming Marketing"** view so an admin can answer "what is in flight?" without opening Dynamics — and, unlike the Calendar page, it shows the underlying record rather than a timeline.

It is the **second CRM feature**, built on the same machinery as [12 — Meetings](12-meetings-all.md): saved views, the column picker, the filter builder, quick-filter dropdowns, the detail drawer, the row cap and the Excel export are all the *same code*, parameterised per entity. See [Shared architecture](#shared-architecture).

- **Every state.** Pre-Launch, Live Outreach, Meetings Ongoing, Schedule Closed, Preparing Feedback, Pause, Complete.
- **Every date**, past and future, with no recency floor.
- **No row scoping.** `v_admin_events_all` is unscoped; every client's events are returned to whoever loads the page.
- **View only.** Nothing is editable and nothing writes back — Dynamics is the system of record. The drawer is structured so that changes (see [Edit-ready](#edit-ready-deliberately-not-editable)).

## Security

Identical to Meetings, and for the same reason: the page reads an unscoped view through the service-role client, which bypasses RLS, so a successful load hands the caller the firm's entire event history. Three independent gates:

1. **`lib/access-control.ts` `ADMIN_ONLY_ROUTES`** now holds `/meetings` **and** `/events` — super-user-only, and **not** grantable to another role through the Admin → Roles matrix. Checked *after* the super-user backstop and *before* the matrix lookup, so a stray `role_page_access` row cannot open it.
2. **`proxy.ts`** runs `canAccessRoute` before the page renders.
3. **`app/events/page.tsx`** re-checks the **effective** role server-side before it builds any query — a page is not the only way in, so it does not assume the proxy ran.

Every server action in `app/events/actions.ts` re-checks too, because a server action is its own entry point and can be invoked directly.

The nav entry is gated by `canSeeCrmNav`, which requires **both** `role === "super_user"` **and** `canAccessRoute`. For a non-super-user the whole CRM block is absent from the DOM — no item, no divider. Covered by `lib/nav-crm.test.ts`, which asserts the rule for every role in the system and for every item in the block.

## The ten list columns

The columns of the CRM’s "Current and Upcoming Marketing" view, plus the capacity trio. This is the default layout every built-in view uses.

| # | Column | Source | Notes |
|---|--------|--------|-------|
| 1 | **Event Title** | `events.name` | **Leads the table** — the row's identity and its handle. **Click to open the drawer** |
| 2 | Client | `events.client_account_name` + `accounts.ticker_symbol` | Shows the **ticker** (full name on hover), **links** to `/client-detail?account_id=…`, then the **account-team circles** — see below |
| 3 | Dates | `events.dates` | Free text as entered in the CRM, e.g. `10/2 & 10/3` — not a timestamp |
| 4 | Location | `events.event_location` | |
| 5 | Event State | `events.event_state_label` | A **coloured pill** carrying the full state |
| 6 | Meetings | *counted from* `public.meetings` | Confirmed meetings on the event. **Not** the stale `events.confirmed_meetings` rollup |
| 7 | Slots | `events.of_slots` | The event’s meeting capacity. Blank when unset — **549 of 968** events have none |
| 8 | Remaining | *computed* | Slots − Meetings. **Negative = overbooked**, shown in red; **92 of the 419** events with a slot count currently are |
| 9 | Targeting URL | `events.targeting_url` | Opens the SharePoint document in a new tab |
| 10 | User/Team Lead | `events.user_team_lead` | e.g. `LJ \| Team = No`. Sparse: ~15% populated |

**Event Title leads, where the CRM view puts it sixth.** That is the one place this layout deliberately differs: the title is what identifies the row and what you click, so it reads first, the way a name column should.

**The Client column carries the account-team circles**, the same cluster Client Portfolio shows in its Account Team column — literally the same component (`components/account-team-avatars.tsx`) over the same four roles, in the same order and colours:

| | Role | Source column on `accounts` |
|---|------|------------------------------|
| ⬤ | Account mgr | `sales_lead_primary_name` |
| ⬤ | Secondary | `secondary_manager_name` |
| ⬤ | Associate | `associate_name` |
| ⬤ | Logistics | `logistics_coordinator_name` |

Up to four 24px circles, overlapping by 8px, earlier roles on top. A blank role is dropped rather than shown empty, so the count varies: of the 141 accounts behind live events, **65 show four circles and 67 show three**; none show zero. Hovering a circle gives `Role: Full Name`.

**Layout: ticker left, circles right.** The cell is a fixed **132px**, with the link pinned left and the cluster pinned to the right edge, so the circles land on the same vertical line on every row however many of them there are — measured, the cluster’s right edge sits at 124px on 2-, 3- and 4-circle rows alike. The trade-off of right-aligning is that the roles do not line up by position: on a three-circle row the navy Account mgr sits where a four-circle row shows Secondary. Aligning left instead would swap those two properties.

The ticker takes the remaining ~38px and **ellipsizes** rather than widening the column; the cell’s hover title is the full client name. Only `ARCAD`, `AKRBP` and `TRAXIONA` are long enough to clip — **24 of 968 rows (2.5%)**, and 2 of the 144 in the default view.

Initials come from the **global** account-team directory via the app-root `TeamInitialsProvider`, so a person whose two-letter initials collide with anyone else in that directory expands to three letters — identically on Events, Portfolio and Profiles. Live example: **Katie Murphy = KMu**, **Kaila Migliazza = KMi**, and both appear in the Logistics slot on different accounts.

The directory itself (`dashboard/lib/team-initials-directory.ts`) is a whole-table read of `accounts`, and the provider is mounted at the app root — so it used to run on all 48 pages although only ~7 render avatars. It is now **cached in-process for 5 minutes**: it is the same map for every viewer, carries no per-user data, and only changes when the sync rewrites `accounts` (every 10 minutes on weekdays), so the worst case is a newly-added colleague disambiguating a few minutes late. See the caching rule in [00 — Architecture](00-architecture.md).

> **The circles are the ACCOUNT team, and are read from `accounts` — never from the event.** `v_admin_events_all` carries its own `account_manager_name` and `logistics_coordinator_name`, but those are the **event’s** staffing and are different people from the account’s on **187** and **148** live events respectively. Using them would have quietly shown a different team than Portfolio for the same client. The four names are merged in server-side in `app/events/page.tsx` by one bulk read of `accounts`, keyed on `client_account_id` — the same approach Portfolio uses. Verified: all **105** accounts appearing on both pages resolve to an identical team.

They are **screen-only**. Not catalog columns, so they never reach the column picker, a saved view, or the Excel export — where the Client column stays the plain client **name** text. The read is fail-soft: if it errors the circles are simply absent, never a blank table.

**The capacity trio is the drawer's [stat row](#the-capacity-stat-row), promoted to the table.** Same three numbers, same definitions, computed in the same view — so the table and the drawer cannot disagree, and "how full is this event" is answerable without opening a row. They sit together after Event State so they read as one band.

These three are **right-aligned with tabular figures**, so a column of them lines up and can be compared down the page, and they are the page's only `number` columns — a distinct field type, because the text operators are not merely useless on an integer but fatal: PostgREST sends *contains* as `ilike`, and `integer ~~* unknown` is error 42883, which blanks the page. Their filter row therefore offers **is / is not / is empty / is not empty** only.

Every column is sortable, and the sort is part of the view. Sorting **Remaining ascending** puts the worst overbookings first. The default is **Meetings Start descending** — `Dates` is free text and cannot sort meaningfully, so the real `event_start_actual` timestamp does the ordering.

### Column groups

The bands above the headers, over the default layout:

| Band | Columns |
|------|---------|
| **Event** | Event Title |
| **Client** | Client |
| **Event Details** | Dates, Location, Event State |
| **Meetings** | Meetings, Slots, Remaining |
| **Planning** | Targeting URL |
| **People** | User/Team Lead |

**Why the title has a band to itself.** A band is a run of ADJACENT columns. With the title leading and Client second, leaving the title in the same group as Dates/Location/State would print "EVENT" twice with "CLIENT" wedged between them — which reads as a bug rather than as a grouping. Splitting the name off from its attributes ("Event" vs "Event Details") keeps every band contiguous and every band labelled.

The full catalog is larger: the picker offers every field the drawer shows plus a few list-only extras, grouped as **Event · Event Details · Client · Meetings · People · Planning · System**.

## Default view: Current & Upcoming

`state_label = 'Active'` **AND** `event_state_label ≠ 'Complete'` — **144 of 968** live events, which is what makes the page open fast. The parallel of Meetings opening on Upcoming.

"Not Complete" rather than a list of good states is deliberate: it is the one rule that survives a new event state being added to the CRM.

Four other built-ins ship as read-only **System** views: **Live Outreach**, **Pre-Launch**, **Preparing Feedback**, and **All events**. Like Meetings' built-ins they are code, not rows — always present, never editable, no seeding step.

## The detail drawer

Slides in from the right, rendered as a **sibling** of the list so opening a record cannot remount the table — which is what keeps the scroll position and virtualisation window intact. Fetched **on demand**: the list carries only its ten display columns.

Unlike the Meetings drawer this needs no `_raw` at all. `public.events` is a fully flattened mirror, so every field the drawer wants is a real column.

**Header:** Event Title, Event State (coloured pill), Marketing State.

### The capacity stat row

Three tiles at the top of the drawer, above General:

| Tile | Definition |
|------|------------|
| **Meetings** | Count of **Confirmed** meetings attached to this event (`meetings.event_id` = the event, `meeting_status_label = 'Confirmed'`) |
| **Meeting Slots** | The event's `# of Slots` (`events.of_slots`) |
| **Slots Remaining** | Meeting Slots − Meetings |

All three are computed **in `v_admin_events_all`**, not client-side over any dataset — the drawer's single-row fetch brings them down with everything else.

**They reconcile with Portfolio's "Open Slots".** The confirmed count is the identical definition the `event_confirmed` CTE in `sql/03_views.sql` uses, which backs both Portfolio's Open Slots column and `v_client_todo.open_slots`. Verified against live data: recomputing Portfolio's per-client totals from these same inputs reproduces `v_client_portfolio.open_slots` for **all 109 clients, 0 differing**.

> **Do not use `events.confirmed_meetings` or `events.slots_remaining`.** Those are Dynamics rollups and they are **stale**: measured on 2026-09-10, `confirmed_meetings` disagrees with the real count on **29 of 968 events** — reporting 0 where the mirror holds 3, 2 and 6 Confirmed meetings — and `slots_remaining` disagrees on 38 of the 419 events that have a slot count. The rest of the app already ignores them; this view does too.

Two display rules:

- **No slot count → an em dash**, for both Slots and Remaining, never `0`. Capacity unknown is not capacity zero, and "0 remaining" would read as "full". This is the common case: **549 of 968** events have no slot count.
- **A negative Remaining means overbooked and is shown as-is**, tinted red. Also not rare — **92 of the 419** events with a slot count are currently overbooked.

**One deliberate divergence from Portfolio.** Portfolio floors each event at `GREATEST(of_slots − confirmed, 0)` because it *sums* across a client's events, where a negative would silently cancel out another event's genuinely open slots. The drawer does **not** floor: on a single event, "−5" is the useful answer. So for a healthy event the two agree exactly; for an overbooked one the drawer shows −5 where Portfolio contributes 0. Same inputs, same subtraction, different treatment of the floor.

**General** — Client (linked), Location, TBC, Dates, Account Manager, Logistics Coordinator, Feedback Team, Feedback Report, Lead(s), Team?, Event Notes, Meetings Start, Meetings End.

**Planning** — Event Parameters, # of Slots, Urgency, Launch Week, Memo Date, Last Data Upload, Shareholder Report Received, Targeting Not Required, Memo Not Required, Targeting Date, Targeting URL, Profile Link, Targeting Notes, Launch, Outreach Complete.

**Account Manager, Logistics Coordinator and Feedback Report render as circle avatars** — the shared `AccountTeamAvatars`, the same object as the clusters on Portfolio, Profiles and the Meetings table.

**Company Representatives and Company Preferences are deliberately absent in v1.** Both are related contact records and contacts are not confirmed synced. Adding them means one more section in `lib/events/record.ts` — no change to the drawer, the catalog or the table.

### Field-sourcing notes

Three worth knowing, all verified against live data:

- **Account Manager is `sales_lead_primary`, not `manager`.** `public.events` has a `manager_id`/`manager_name` lookup and it is **empty on all 968 rows**. `sales_lead_primary_name` fills 966 and agrees with `accounts.sales_lead_primary_name`, the field Portfolio already calls the account manager. The dead lookup is ignored.
- **Memo = Teaser — an assumption.** The drawer asks for "Memo Date" and "Memo Not Required". `public.events` has no `memo_*` columns; it has `teaser_date` (78% populated) and `teaser_not_required` (80%). Rose's CRM calls the artefact a teaser, this page calls it a memo. **If that mapping is wrong**, fix the two aliases in the patch and the two labels in `lib/events/record.ts`.
- **Two fields are empty everywhere.** `targeting_notes` and `shareholder_report_received_date` are 0% populated across all 968 events. They are surfaced anyway because they are the columns the drawer asks for — they will fill in when the CRM does.

### Edit-ready, deliberately not editable

Every section renders from the field-definition list in `lib/events/record.ts` — `{ label, sourceKey, type }` per field, `type ∈ text | date | person | toggle | notes | link` — rather than hand-written JSX per field. Turning the drawer into a real editor is therefore localised: swap the read-only renderer for an input keyed off `type`, add form state, add a save action. The sections, labels and ordering do not move.

Do **not** add editing without the dashboard actually becoming a system of record for events.

## Saved views and filters

Identical in behaviour to Meetings — see [that page's docs](12-meetings-all.md#saved-views) for the full model. In short:

- **System** views (shared; the built-ins plus any a super-user saves) and **Personal** views (private to the login), each with a default.
- Resolution order: `?view=` → personal default → system default → built-in **Current & Upcoming**.
- **Save / Save as… / Save as System / Set default / Manage**.
- **Edit columns** and **Edit filters** work exactly as on Meetings, over the events catalog.
- Personal views live in `event_saved_views`, a table of the same shape as `meeting_saved_views`. The **authorisation code is shared** — one implementation in `lib/table-views/saved-views.ts` governs both.

### Quick filters

Three dropdowns, all applied **server-side** and all landing on indexed columns:

| Filter | Matches on | Control |
|--------|-----------|---------|
| **Client** | `client_account_id` | Typeahead (~189 clients) |
| **Event State** | `event_state_label` | Native select (7 states) |
| **Account Manager** | `account_manager_id`, expanded across the person's alias group | Native select |

They AND with each other, with the active view's own filters, and with the keyword box. They are **not** part of the saved view — they ride in their own URL params (`?client=`, `?state=`, `?mgr=`), so picking a state does not mark the view "edited".

**Account Manager expands across alias groups**, the same trap Meetings hit: two people in this CRM carry duplicate Dynamics systemuser records, so filtering on one raw id would silently return part of their events. The options view emits the **canonical** id and the filter expands it to `IN (…)` — still a plain index scan.

The choices load **lazily**, after the table renders, and are cached for the browser session. Nothing on screen needs a dropdown's contents in order to paint a table.

## Performance

The same shape as Meetings, and the reasons are documented there:

- The list query names its columns and **never selects `*`** — notes columns are not dragged into rows that do not show them.
- **`_raw` is never in the list.** `v_admin_events_all` does not even expose it.
- The drawer fetches **one row on open**.
- Filter-dropdown options come from a **dedicated distinct view**, `v_admin_events_filter_options`, off the critical path.
- The unfiltered load is **capped at 2,000 rows** with a "showing first N — refine filters to narrow" notice. At 968 live events the cap does not currently bite, but it is the same guard, and it will matter as the mirror grows. The **Excel export is not capped** — it re-runs uncapped through a server action, because capping the page must never silently truncate a spreadsheet.

Indexes added by the patch: `(state_label, event_state_label)` for the default view, `event_state_label` for the dropdown, and `sales_lead_primary_id` for the Account Manager filter. `client_account_id` and `event_start_actual` were already indexed by `sql/16_events_table.sql`.

## Shared architecture

Events is not a copy of Meetings. The machinery was **generalised** when Events was built, and Meetings was moved onto it — so there is one implementation, not two:

| Shared | What it holds |
|--------|---------------|
| `lib/table-views/types.ts` | Column, filter, view and saved-view vocabulary, plus the `EntitySpec` contract |
| `lib/table-views/config.ts` | Config validation, the `?cfg=` round-trip, default resolution |
| `lib/table-views/query.ts` | Select-list building, filter → PostgREST translation, paging, the row cap, the column probe, distinct options |
| `lib/table-views/saved-views.ts` | **The write path.** All five authorisation invariants, once |
| `lib/table-views/excel.ts` | The export |
| `components/table-views/` | Column editor, filter editor, view switcher, quick-filter bar |

Each entity supplies a **spec** (`lib/events/spec.ts`, `lib/meetings/spec.ts`) naming its view, id column, catalog, default sort, built-ins, saved-views table and options view — plus its own cell renderers, which are the genuinely entity-specific part.

**Adding a third CRM page should mean writing a spec and a catalog**, not another copy of the query, validation and authorisation layers.

## Where things live

| Thing | Path |
|-------|------|
| Page (server, holds the gate) | `app/events/page.tsx` |
| Table (client) | `app/events/events-view.tsx` |
| Detail drawer | `app/events/event-record-pane.tsx` |
| Server actions (record, export, saved views, options) | `app/events/actions.ts` |
| Drawer field definitions | `lib/events/record.ts` |
| Account-team roles, colours + member mapping | `lib/account-team.ts` (shared with Portfolio) |
| Account-team circle rendering | `components/account-team-avatars.tsx` (shared) |
| Column catalog + built-ins + spec | `lib/events/spec.ts` |
| Quick filters | `lib/events/filters.ts` |
| Row type | `AdminEventRow` in `lib/types.ts` |
| List view | `v_admin_events_all` in `sql/03_views.sql` |
| Filter options | `v_admin_events_filter_options` in `sql/03_views.sql` |
| Saved views table | `event_saved_views` in `sql/02_rose_owned_tables.sql` |
| SQL patches (deployed) | `sql/patches/2026-09-10_admin_events.sql`, then `…_admin_events_slots.sql` |
| Nav entry + gate | `CRM_NAV_ITEMS` / `canSeeCrmNav` in `lib/access-control.ts` |
