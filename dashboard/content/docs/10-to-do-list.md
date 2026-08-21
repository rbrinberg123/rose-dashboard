# 10 — To-Do List

## What it does (plain language)

**Clients → To-Do List** (`/clients/to-do`) is one wide row per **active client**, pulling together everything that usually needs chasing: how much you've met them, when you last spoke to them, when their data was last uploaded, what their next marketing event looks like, what feedback is still open, and a free-text note you can type straight into the table.

It is a **worklist**, not a report. The colours are the point:

- **Amber** = getting stale / needs attention.
- **Red** = badly overdue, or never happened at all.
- **✓ Clear** = nothing open.

Sort by any column (click the header), filter to one **Client Manager**, search by client, ticker, or event name, and scroll sideways for the later columns. The default order is **client name A–Z** — note that this is the client's full *name*, not its ticker, so the tickers won't read alphabetically on first load (Aker BP's `AKRBP-NO` sorts before Alamos Gold's `AGI-CA`). Click **Ticker** to sort by ticker instead.

**The column header now matches Client Portfolio**, from the shared `dashboard/components/table-group-header.tsx`: white bands with navy small-caps section labels (Client · Meetings · Touchpoints · Current & Upcoming Event · Feedback · Notes) — no grey fills — separated by white gutters, a plain white sub-column row, and one continuous navy→blue→teal sweep at the header/body boundary broken into a segment per section. The header is sticky and opaque, and the card clips to its rounded corners so rows scroll behind the curve.

Rows are deliberately dense — this is meant to be a whole client book you can scan without scrolling. The note box sits on one line at rest and grows when you click into it.

### Who sees what

The page is **client-scoped**. You see a row for every active client **you're on the account-management team for** — the same rule as Portfolio and Client Detail. Someone with the "All" data scope (and every Super User) sees every active client. If you have no client access at all, the page shows "No clients assigned to you" rather than an empty table.

Access to the page itself is separate from that: it's an independently-grantable row in **Admin → Roles**, so a role can be given the To-Do List without being given Portfolio or Client Detail.

### The status key

A compact **colour key** sits directly above the toolbar, listing the five status pills with their labels so a viewer can read the Status column without guessing. It is the shared `NoteStatusLegend` — the same component and the same 9px pill styling Portfolio's legend row uses. Screen-only (`no-print`), like Portfolio's.

### The toolbar

- **Client Manager** — narrows the table to one manager's clients. Defaults to **all**. The dropdown lists only managers of clients **you can already see**, so it never reveals who runs an account outside your scope. "Client Manager" here means the client's **account manager** (`accounts.sales_lead_primary_name`), which is owned in the CRM and read-only in the dashboard — this is a filter, not an assignment control.
- **Search** — matches client name, ticker, or event name.
- **Export to Excel** — downloads an `.xlsx` of **exactly what's on screen**: the rows as currently filtered (search + Client Manager) and in the current sort order, not the whole table. Filter first, then export. The file is named `client-todo-list_YYYY-MM-DD.xlsx`.
- **Export PDF** — the same current view, but as a **landscape PDF that looks like the table**: the same twelve columns with their status pills, open-slots ambers, aging colours and feedback pills intact, under a "Client To-Do List" header carrying the date and the filters that were applied. It opens your browser's print dialog — choose **"Save as PDF"** as the destination. Filter first, then export, exactly as with Excel. Suggested filename `client-todo-list_YYYY-MM-DD.pdf`.
- The count on the right reads "*N* of *M*" so you can see how much the filters are hiding.

Which to use: **Excel** when you want to sort, pivot or re-cut the numbers; **PDF** when you want to circulate or print the worklist as it looks.

### The columns

| Column | What it means |
|--------|---------------|
| **Ticker** | The client's stock ticker, **base form only** — the exchange suffix is dropped, so `TNL-US` shows as `TNL` and `4DX-AU` as `4DX`. **This is the row's identity**: click it to open that client's Client Detail page, hover it to read the full client name. (There is no separate Client-name column: the ticker carries both jobs, which keeps the table narrow.) |
| **Meetings YTD** | Confirmed meetings held since **January 1 of the current year**, up to today. |
| **Meetings L12M** | Confirmed meetings held in the **trailing 12 months**, up to today. |
| **Last Touch** | The date of the client's most recent **CRM touchpoint**. Amber at 60+ days, red at 90+, red "Never" if there has never been one. **Hover or click the date** to see the touchpoint behind it — its type, subject, exact date and time, and owner. |
| **Last Upload** | The date of the client's most recent completed **Outreach → Data Upload** task. Amber at 120+ days, red at 180+, red "Never" if there has never been one. |
| **Status** | The client's status flag from their **latest client note** — At Risk · Lost · New Client · Stable · Strong — as a colour pill. It sits in the **Client** section beside the ticker, because it reads as client identity rather than as an activity metric. This is the **same pill, the same five values and the same colours as Client Portfolio's "Status (latest note)"** column: both render `NoteStatusPill` from `dashboard/components/note-status.tsx`, over the palette in `lib/design.ts` (`NOTE_STATUS_PILL`) that the Client Statistics "Clients by Status" donut also reads — so pill, key and chart cannot drift. Hover a pill for the date the status was set. A client with no note on record shows an em dash. Clicking the header sorts by **severity** (At Risk first), not alphabetically — again matching Portfolio. |
| **Current & Upcoming Event** | The name of the **soonest current-or-upcoming** marketing event, in a deliberately narrow column — long names truncate with an ellipsis and the full name is on hover. The leading ticker is **stripped** from the name ("4DX-AU - Virtual - September, October (TBC)" shows as "Virtual - September, October (TBC)") because the Ticker column already says whose event it is. "None" if there isn't one. |
| **Status** | That event's stage, as a coloured pill (Pre-Launch, Live Outreach, Meetings Ongoing, Schedule Closed, Preparing Feedback, Complete). |
| **Date** | That event's meeting window — a single day, or a start–end span. |
| **Mtgs** | How many **confirmed** meetings that event has. |
| **Open Slots** | Slots on the event minus confirmed meetings. Shown as an **amber pill whenever it's above zero** (there is still room to fill), plain `0` when full, and a dash when the event has no slot capacity set. |

**Click anywhere in the event group** — the name, status pill, date, meeting count, or open slots — and that event's **confirmed meetings slide out in the right-side detail pane**, each showing date, institution, and investor. It's the same pane, styling, and close behaviour as the Marketing Events block on Client Detail. The whole five-column cluster highlights together on hover and stays tinted while its pane is open, so it reads as one button. Clicking a different row's event swaps the pane's contents. Rows with no current or upcoming event aren't clickable.
| **Open Items** | Two feedback figures — `N rep` (open feedback **reports**) and `N col` (open feedback **collections**). Hover for the detail behind each. Shows **✓ Clear** when both are zero. |
| **Notes** | Free text you type directly in the table. Saves when you click away. |

### Notes: how they behave

Type in the box and click (or tab) away — that's the save. There is no Save button.

- Notes live **only in the dashboard**. Nothing is written back to Dynamics.
- Anyone who can see the client can edit its note.
- **Last write wins**: the most recent save is what everybody sees. There's no per-person note and no edit history, so if two people type at once, whoever clicks away last is the version that sticks.
- Clearing the box clears the note.
- If a save fails you get a red toast and your text stays in the box, so nothing typed is lost.

---

## Technical

### Files

| File | Role |
|------|------|
| `dashboard/app/clients/to-do/page.tsx` | Server loader — resolves the client scope, reads `v_client_todo`, and fetches the feedback tooltip detail. |
| `dashboard/app/clients/to-do/todo-table.tsx` | The client-side table: sorting, search, pills, aging colours, inline notes. |
| `dashboard/app/clients/to-do/todo-scope.ts` | **Pure** scoping decisions (`decideTodoLoad`, `visibleTodoRows`, `canEditClientNote`). |
| `dashboard/app/clients/to-do/todo-scope.test.ts` | Unit tests for all three (`npm test`). |
| `dashboard/app/clients/to-do/actions.ts` | `saveClientTodoNote` — the scoped upsert behind the inline note. |
| `dashboard/lib/client-todo-excel.ts` | ExcelJS workbook + download for the "Export to Excel" button. Also exports `ymd()`, shared with the PDF filename. |
| `dashboard/lib/client-todo-format.ts` | Pure display helpers shared by the table and the export. |
| `dashboard/app/globals.css` | The `@media print` block behind "Export PDF" — shared with Client Portfolio. |
| `dashboard/components/event-meetings-pane.tsx` | **Shared** right-side confirmed-meetings drawer. Also used by Client Detail. |
| `dashboard/lib/event-meetings.ts` | **Shared** event → confirmed-meetings read. Also used by Client Detail. |
| `sql/20_client_todo.sql` | `public.client_todo_notes` + `public.v_client_todo`. **Must be run in the Supabase SQL editor** before the page will load. |

### Client scoping

The page is a **Level-2 client-scoped** page and uses `resolveClientScope` (`lib/access/data-scope.ts`) exactly like Portfolio and Client Detail. Because the app queries Supabase with the **service-role key**, RLS is bypassed and **the loader is the only gate** — so the scope is applied three times, deliberately:

1. `decideTodoLoad(scope)` → `deny` (render `NoClientsAssigned`), `all` (no filter), or `filter` (an `.in("account_id", …)` on the query).
2. `visibleTodoRows(rows, scope)` re-filters whatever came back, so a query that somehow returned an out-of-scope row still can't render it. A row with no `account_id` is never visible to a scoped user.
3. `canEditClientNote(scope, id)` gates the **write**: `saveClientTodoNote` re-resolves the caller's scope server-side on every save and refuses a client the caller can't see. The account id from the browser is never trusted.

The tooltip queries against `v_feedback_pipeline` / `v_feedback_outstanding` and the base `touchpoints` table are filtered to the same account ids and re-checked against the visible set before grouping.

### Hover detail

Three cells carry a hover panel (the same group-hover treatment the Capacity chart uses), all built from data the loader fetches alongside the view:

- **Ticker** — the full client name, as a plain `title` tooltip.
- **Last Touch** — the touchpoint behind the date: `touchpoint_type_label`, `subject`, the exact `scheduled_start`, and `owner_name`. `v_client_todo` carries only the date, so the row itself comes from the base `touchpoints` table. The loader walks that client's touchpoints newest-first and takes the first one landing **on or before the Eastern day the cell shows** — matching on the day rather than just taking the newest row is what stops the tooltip and the date ever disagreeing (the view caps `last_touch_date` at today, so a touchpoint scheduled later today is skipped here too). The panel opens on hover *and* on focus, so it is reachable by click and keyboard.
- **Open Items** — the event/subject of each open report and the date · institution of each open collection.

### Excel export

`lib/client-todo-excel.ts` builds the workbook with **ExcelJS**, lazily imported inside the click handler so its weight only loads when someone actually exports — the same pattern (and the same library) as the Upcoming Meetings export in `lib/pipeline-excel.ts`. `buildClientTodoWorkbook` is split out from the download so the sheet's shape and cell types can be exercised without a DOM.

**Scoping:** the export is generated client-side from `sorted` — the rows already rendered — and fetches nothing. Those rows came through `resolveClientScope` and `visibleTodoRows` in the loader, so the file can only ever contain clients the viewer is authorised to see.

Thirteen columns, flattened from the interactive cells — **note that the Excel export does not carry the Status column**; it is a parallel column list, so the sheet still has the thirteen below rather than the fourteen now on screen: Ticker (base form), Meetings YTD, Meetings L12M, Last Touch (CRM), Last Data Upload, Current & Upcoming Event (ticker prefix stripped, as displayed), Event Status, Event Date, Event Meetings, Open Slots, Open Reports, Open Collections, Notes. The header row is bold and frozen, and an autofilter spans it.

Types are real wherever a real type exists — counts as numbers, the two touchpoint dates as Dates with a `mmm d, yyyy` format — so the sheet sorts and filters natively. Two deliberate choices:

- **Missing values are blank, never `0` or "None".** An event with no slot capacity, a client never touched, a row with no upcoming event — all leave the cell empty, so "unknown" can't be mistaken for "zero" in a pivot or a sum.
- **Event Date stays text.** It is a *window* (`Sep 21 – Oct 16, 2026`), and no single date cell would be correct for a multi-day event. Splitting it into real Event Start / Event End columns is the alternative if sorting on it ever matters.

Dates are built at UTC midnight (`dayToDate` in `lib/client-todo-format.ts`) because ExcelJS converts a `Date` via its UTC epoch with no timezone shift — so the day in the cell is exactly the Eastern day the view computed, regardless of the exporter's browser zone.

The display helpers the export shares with the screen (`baseTicker`, `stripTickerPrefix`, `formatDay`, `formatDaySpan`) live in **`lib/client-todo-format.ts`** precisely so an exported cell can't drift from the cell it mirrors.

### PDF export

There is **no PDF library in the app.** "Export PDF" reuses the mechanism the Client Portfolio's button already uses (`app/portfolio/portfolio-table.tsx`): a bare `window.print()` over the `@media print` stylesheet in **`app/globals.css`**. The browser's own "Save as PDF" destination does the rendering. Nothing is added to the bundle.

The contract between the table and the stylesheet is by class:

- `.todo-print-root` wraps the whole component and scopes every print rule.
- `.print-only` is the branded report header — `display: none` on screen, revealed only on paper. It carries "Rose & Co", **Client To-Do List**, the generated date, and a filter summary built from the *live* filter state (`Client Manager = …`, the search text, and the row count), so the sheet always states what it's a view of.
- `.no-print` hides the screen chrome: the title card, the whole filter/search/export toolbar, and the event-meetings drawer.

Because it prints the **rendered** table, the export inherits everything for free — the pills, the aging reds and ambers, and the client scoping (nothing is re-fetched; there's no second code path to drift, unlike the Excel export's parallel column list).

What the print rules have to undo, and why:

- **Landscape** (`@page { size: landscape }`) and `print-color-adjust: exact`, or browsers strip the pill fills.
- `thead { display: table-header-group; position: static }` — repeats the three-tier header on **every page** and drops the sticky positioning that would otherwise pin it.
- `min-width: 0` and `font-size: 8px` on the table, plus the card's `overflow-x-auto` forced to `visible` — on screen the table has a 1180px no-squish floor inside a sideways scroller; on paper there is no sideways, so that floor would run off the sheet and the scroller would clip the rows to one screenful instead of paginating.
- **`white-space: normal` on every `th` and `td`.** This is the rule that actually fits the table to the page. Every cell is `nowrap` on screen, and those runs become the table's minimum width — with them the 12 columns need ~1045px, which overflows a landscape Letter sheet's ~979px printable area. Letting the long ones ("Current & Upcoming Event", an event date span) take two lines brings it to ~929px, inside both Letter and A4. The event name also drops its 150px ellipsis truncation, since hover doesn't exist on paper.
- **Notes gets `width: 20%`.** It's the only free-text column, so once every other column is sized to its content it would otherwise collapse to a ~57px sliver.
- `tr { break-inside: avoid }` so a client's row is never split across a page break.

**The note field is the one thing that doesn't translate.** A `<textarea>` prints as an empty one-line box — its value isn't laid out for paper and the scroll position clips it. So `NoteCell` renders the control *and* a static `.todo-print-note` twin: the textarea carries `data-print="hide"`, and the twin is `.print-only` and wraps (`pre-wrap`). The twin reads the component's `value` state rather than `row.note`, so a note typed but not yet blurred still makes it into the PDF.

**Filename.** The browser seeds "Save as PDF" from `document.title`, so the handler swaps the title to `client-todo-list_YYYY-MM-DD` for the duration of the print call and restores it on `afterprint`. The date comes from `ymd()` — exported from `lib/client-todo-excel.ts` and shared with the `.xlsx` name, so both downloads always agree on the date. This is a *suggestion*: the browser's save dialog lets the user rename, and some browsers ignore the title entirely.

The shared reshaping rules are written as a selector list covering both `.portfolio-print-root` and `.todo-print-root`; only the fit-to-page rules above are To-Do-specific.

### The shared event-detail pane

The event cluster opens **`components/event-meetings-pane.tsx`** (`EventMeetingsPane`) — the *same* component Client Detail's "Marketing Events & Dates" block opens. It was extracted from that block verbatim (it in turn was modelled on the Investor Reach Depth `Sheet`), so both pages get one drawer: same width, slide-in, "Marketing Event" eyebrow, title, `date span · N confirmed meetings` subtitle, meeting list, and close affordance. The pane sorts its meetings by date ascending internally, so neither caller has to remember to.

Its rows come from **`lib/event-meetings.ts`** (`loadConfirmedMeetingsByEvent`) — the one shared read for `meetings.event_id` + `meeting_status_label = 'Confirmed'`, selecting the fields the pane renders. Both loaders call it; there is no parallel query. Client Detail additionally derives its meeting-count chip and its Current/Previous bucketing dates from that same result, so a single query backs all three.

`loadConfirmedMeetingsByEvent` does **no scoping of its own** — it takes ids the caller has already scope-checked. To-Do passes `next_event_id` from `rows`, which the client scope has already filtered; Client Detail passes the selected client's event ids, which were scope-checked when the client was resolved. Both are therefore scoped implicitly, and the To-Do page stays entirely inside its existing client-scoped loader.

Interaction detail: the five cells are separate `<td>`s, so a plain CSS `:hover` can't tint them as a group. The table tracks a `hoverEventRow` (and compares `openEvent.eventId` for the selected tint) and applies both to all five cells. The first cell of the cluster carries `role="button"`, `tabIndex`, an `aria-label`, and Enter/Space handling, so the drill-in is reachable by keyboard.

### Client Manager filter

`v_client_todo` does not carry the account manager, so the loader pulls `accounts.sales_lead_primary_name` in one bulk read **restricted to the already-scoped account ids** and merges it in by `account_id` — the same pattern Portfolio uses for its account-team columns. The merged shape is `ClientTodoTableRow` (the view row plus `client_manager_name`), kept distinct from `ClientTodoRow` so the view's own type never claims a column it doesn't have.

The dropdown's options are derived from the **rows already on the page**, not from a separate query, which is what guarantees a scoped viewer can never see a manager name from outside their own client list. The read is fail-soft: if it errors, every row is simply unassigned and the filter offers only "All".

Across the 108 active clients today there are **8 distinct client managers and no unassigned clients**, so selecting a manager never silently strands a row. (If an unassigned client ever appears, it will show under "All" but under no individual manager — which is the correct behaviour, and a signal the CRM record is missing its manager.)

### Ticker display

The ticker is rendered through `baseTicker()` — the same suffix-stripping helper (and name) used by the Planning V2 view and the email builders: `"TNL-US" → "TNL"`, `"4DX-AU" → "4DX"`, while dotted class tickers like `BRK.B` and suffix-less ones like `PYPL` pass through untouched. Checked against all 108 active clients: none strip to an empty string.

Styling **inherits the table's own font family and size** — no monospace face — and is simply **bold in the brand link blue** (`BRAND_BLUE`, `#0355A7`), close to the treatment Planning V2 uses for its client column. It is a link to Client Detail, with `hover:underline` as the affordance.

### Event-name ticker prefix

`stripTickerPrefix` in `todo-table.tsx` removes the leading `TICKER - ` from the event name. It tries the account's full ticker and then its base form (an event may be named `4DX - …` while the account carries `4DX-AU`), tolerates the inconsistent spacing in the CRM names (`MG-CA -  Live …` has a double space), and **leaves the name completely untouched** when it doesn't start with that row's ticker. Checked against all 327 active-event names with an account ticker: every one stripped cleanly, none were mangled.

### Definitions and their sources

**Active client** — `accounts.state_label = 'Active'`, the same definition `v_client_portfolio` uses. Currently 108 clients.

**Meetings YTD / L12M** — `public.meetings` with `meeting_status_label = 'Confirmed'`, bucketed on the **Eastern** meeting day. YTD runs from `date_trunc('year', today)`; L12M from `today - 12 months`. Both are capped at today, so a confirmed meeting already on the calendar for next month is not counted as one that has happened.

**Last Touch (CRM)** — the latest row in `public.touchpoints` for the client, dated on `scheduled_start` (Eastern day) and capped at today. The `touchpoints` table is the mirror of the Dynamics activity Rose relabelled **"Touchpoint"** (the standard `phonecall` entity — see `sql/01_mirror_tables.sql`). **The whole entity is the touchpoint**, so there is no type filter: `touchpoint_type_label` records only the *modality* (Virtual, Email, In-Person, Social, Onboarding Call), not whether a row counts. Every touchpoint counts.

> Note: `accounts.last_touchpoint_date` is a Dynamics rollup of the same thing and agrees for 97 of 108 active clients, but it lags. The view computes the date from `touchpoints` directly.

**Last Data Upload** — the latest **completed** task where `bcs_task_type_label = 'Outreach'` **and** `bcs_task_subtype_label = 'Data Upload'` **and** `state_label = 'Completed'`, linked to the client by `tasks.bcs_account_id` (which for these rows equals `regarding_id`, with `regarding_type = 'account'`). Dated on `actual_end` — when the upload was actually completed — falling back to `scheduled_end` then `scheduled_start`. Open, not-yet-done upload tasks are excluded: they aren't an upload that happened.

> There is also an `events.last_data_upload` field (Dynamics `bcs_lastdataupload`), but it's per-*event*, not per-client, so the task subtype is the right source for a client-level column.

**Soonest current/upcoming event** — bucketed **exactly** as the Client Detail "Marketing Events & Dates" block does (`app/client-detail/client-detail-view.tsx`):

- An event's window is the **min..max Eastern day of its confirmed meetings**.
- An event with no confirmed meetings falls back to its own `event_start_actual`..`event_end_actual`.
- An event is **current/upcoming while that window's end is today-or-later** — it isn't complete until its last meeting ends.
- Undated events (no meetings, no actual window) are dropped.
- Of those, the one with the soonest **not-yet-occurred** day wins (ties break on window start, then event id).

The event universe matches `v_marketing_calendar` (`state_label = 'Active'`, `event_state_label` present and not `'Pause'`) **minus** that view's trailing two-month cutoff — irrelevant here, since we only keep windows ending today-or-later, and keeping it would hide a long-dormant event that still has a meeting ahead of it.

**Event Mtgs** — `COUNT(public.meetings WHERE event_id = <event> AND meeting_status_label = 'Confirmed')`, the same meetings→event link (`meetings.event_id`, from Dynamics `_bcs_event_value`) the Planning and Client Detail pages use.

**Open Slots** — `events.of_slots` (Dynamics **`bcs_ofslots`**) minus the confirmed-meeting count, **floored at 0**; `NULL` (rendered as a dash, meaning *unknown*) when the event has no `of_slots`. Of the four slot-ish columns on `events`, only `of_slots` and `slots_remaining` carry data (`meeting_slots_max` and `spaces_available` are entirely empty); `of_slots` is the **capacity** figure the formula needs. The count comes from `public.meetings`, **not** from the `events.confirmed_meetings` Dynamics rollup, which lags — it was stale on 8 of 200 sampled active events.

**Open Items (Feedback)** — two separate figures, matching the two feedback pages:

- `open_reports` = this client's rows in **`v_feedback_pipeline`** — both categories, `in_progress` + `pending_review` (the same set the Feedback **Reports** page shows). The tooltip lists each item's event name and category.
- `open_collections` = this client's rows in **`v_feedback_outstanding`** (the same set the Feedback **Collection** page shows). The tooltip lists each meeting as `date · institution`.

Both counts come from the view, and the tooltip lists come from the same two views in the loader, so they can't disagree.

### Staleness thresholds

Chosen from the live spread of each date so the colours flag a genuine tail rather than the whole book:

| Column | Amber | Red | Why |
|--------|-------|-----|-----|
| **Last Touch** | 60+ days | 90+ days | Touchpoints run at a median of ~41 days across active clients (p75 ≈ 71). 60/90 marks the slow quartile and the genuinely cold. |
| **Last Data Upload** | 120+ days | 180+ days | Uploads are a much slower cadence — median ≈ 141 days, p75 ≈ 200. The touchpoint thresholds would paint nearly every row red; 120/180 is the equivalent tail. |

A client with **no** date at all shows a red **"Never"** pill in that column. The constants live at the top of `todo-table.tsx` (`TOUCH_AMBER_DAYS`, `TOUCH_RED_DAYS`, `UPLOAD_AMBER_DAYS`, `UPLOAD_RED_DAYS`) — change them there and the legend colours follow.

### Notes storage

```sql
CREATE TABLE public.client_todo_notes (
  client_account_id uuid PRIMARY KEY REFERENCES public.accounts(account_id),
  note              text,
  updated_at        timestamptz NOT NULL DEFAULT now()
);
```

A Rose-owned table (see [03 — Data Model](03-data-model.md)): the sync job never touches it, and nothing is written back to Dynamics. One row per client, **upserted on the primary key**, which is what makes it last-write-wins. No author column is stored — deliberately, for now; adding attribution later means adding a column, not restructuring. `updated_at` is stamped by the action on insert and by the shared `touch_updated_at()` trigger on update, and surfaces as the note field's hover title.

The note text is capped at 4,000 characters by the action's zod schema, and a blank note is stored as `NULL`.

### Gotchas

- **The page will not load until `sql/20_client_todo.sql` has been run.** Until then it shows a "Could not load `v_client_todo`" card naming the file to run.
- `v_client_todo` reads `v_feedback_pipeline` and `v_feedback_outstanding`, so those two views must exist first (they do — they're in `sql/03_views.sql`).
- Every date the view emits is already resolved to an **Eastern calendar day** (`YYYY-MM-DD`), so the UI formats them as plain strings and must not re-parse them as timestamps — that's what `formatDay` in `todo-table.tsx` is for.
- The note textarea adopts a fresh server value on revalidate only when it differs from what was last saved, so someone else's save doesn't wipe text you're mid-way through typing.
- Row density lives in the `CELL` and `PILL` constants at the top of `todo-table.tsx` — change padding and text size there, not on individual cells, or the rows will drift out of alignment.
- The default sort is still `client_name` even though that column is gone, so no header shows as active on first load. That's deliberate (it preserves the documented A–Z-by-client order); switching the default to `ticker_symbol` is a one-line change if the invisible sort ever becomes confusing.
