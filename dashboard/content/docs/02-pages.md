# 02 — Pages

## What it does (plain language)

This is the map of every page in the dashboard: what it's for, who can see it, and where its numbers come from. Pages are grouped in the sidebar into **Clients, Institutions, Productivity, Logistics, Contracts,** and a pinned **Admin** row.

Remember the access rule from [01 — Access & Users](01-access-and-users.md): plain **users** see only the **Logistics** section; **super-users** see everything. A handful of finance pages exist but aren't linked in the sidebar at all — you reach them by typing the URL (super-user only).

## Technical

"Required role" is derived from `USER_ALLOWED_ROUTES` in `dashboard/lib/access-control.ts`: a route in that list is reachable by `user` **and** `super_user`; anything else is `super_user` only. "Reads" is the main Supabase view/table the page's `page.tsx` queries via `.from(...)`. Labels and grouping come from `dashboard/components/nav.tsx`.

### Clients (super-user only)

| Route | Label | Reads | Purpose |
|-------|-------|-------|---------|
| `/client-statistics` | Statistics | `v_client_statistics` + `v_client_stats_by_*` | Portfolio-wide stats by market cap, region, sector, manager, status, days-left. |
| `/portfolio` | Portfolio | `v_client_portfolio` (+ `v_contract_management`, + `contracts` for the doc link) | Active-client roster with health status and contract linkage. **Row-scoped** by `resolveClientScope`. **Financials-gated:** without the [Financials permission](01-access-and-users.md), the Contract band's **Retainer** column and **Doc** (contract-document) column are **not rendered at all** — the band shows 4 columns instead of 6 — and `annualized_retainer` / `quarterly_retainer` / `contract_url` are **deleted server-side** before the payload is sent, so an ungranted user never receives them (the `contracts.contract_url` lookup is skipped entirely). **Export PDF** button prints the current filtered/sorted view (branded header + filter summary) via the browser's Save-as-PDF; print styling lives in `app/globals.css` under `@media print` — it prints the rendered table, so a gated view exports without the money columns too. |
| `/client-detail` | Detail | `v_client_detail_summary` + many `v_client_detail_*` (+ base `touchpoints`, + `v_marketing_calendar`) | Deep-dive on one client: quarterly, institutions, hosts, recent meetings/notes. **Row-scoped** by `resolveClientScope` (a direct URL to an out-of-scope client is blocked). **Financials-gated:** the KPI strip is **6 tiles** — Meetings (LTM/All-time) · Institutions (LTM) · Feedback Rec'd (LTM) · **Annualized Retainer** · **$ per Meeting** · Contract Renewal — but without the [Financials permission](01-access-and-users.md) the two money tiles are **not built** and `annualized_retainer` / `dollars_per_meeting_ltm` are **deleted server-side** from the selected client *and* the whole client-switcher list. The row then renders **4 tiles that stretch evenly to fill it** (the grid's column count follows the tile count) — no blanks, no dashes, no placeholders. `dollars_per_meeting_ltm` is derived from the retainer, so it is always gated with it. The **AI Summary** is not gated: there is one summary per client shown to everyone, and it no longer states retainer / fee amounts **for anyone** (renewal dates are still included). The Account Team / AI Summary card also carries a **Marketing Events & Dates** spotlight (from `v_marketing_calendar` filtered to the client), split by the event's **confirmed-meeting dates** (`public.meetings.meeting_date` / Dynamics `bcs_date`; a meeting is a single point in time, so it is both start and end — resolved to the Eastern day). An event with no confirmed meetings falls back to its own `event_start_actual`..`event_end_actual` window. **Current & Upcoming** (left) = every event whose latest meeting day is today-or-later (**no cap**, sorted by the soonest not-yet-occurred meeting day, nearest first); **Previous** (right) = events where all meetings have ended, showing **only the single most-recently-completed** one. Each row shows a date tile (event start = earliest meeting day), the event's start–end span, a **confirmed-meeting count chip** (navy tint; labelled "confirmed" on both columns — confirmed meetings only, excluding tentative/cancelled/any non-confirmed status), and a stage pill colored from `event_state_label` (Live Outreach / Meetings Ongoing → green, Pre-Launch → blue, Schedule Closed → amber, Preparing Feedback / Complete → grey, unknown → grey). The count is `COUNT(public.meetings WHERE event_id = <event> AND meeting_status_label = 'Confirmed')` — the same meetings→event link (`meetings.event_id`, from Dynamics `_bcs_event_value`) and status the Planning views use; queried per selected client's event ids, fail-soft to `0`. Each event row is **clickable** (hover + selected state): it opens that event's confirmed meetings in the **shared right-side detail pane** — `components/event-meetings-pane.tsx` (`EventMeetingsPane`), extracted from here and now shared with the To-Do List, built on the same `Sheet` drawer the Investor Reach Depth section uses (same width / slide-in / header / close). Its rows come from the shared `loadConfirmedMeetingsByEvent` read in `lib/event-meetings.ts`, which also backs the count chip and the Current/Previous bucketing dates — one query for all three. The pane header is the event name + its date span; the body lists confirmed meetings only, sorted by date, each showing date (`meeting_date`), institution (`institution_name`), and investor (`investor_text` / Dynamics `bcs_investor`), with a small empty note if an event has none. The block degrades to empty column placeholders ("No current or upcoming events" / "No previous events") and never blanks the page if the view is missing. |

| `/clients/to-do` | To-Do List | `v_client_todo` (+ `v_feedback_pipeline` / `v_feedback_outstanding` / `touchpoints` for the hover detail, + `accounts` for the Client Manager filter) | One row per **active** client, filterable by **Client Manager** (options built from the viewer's own scoped rows): meetings YTD/L12M, last CRM touchpoint, last Outreach → Data Upload, the soonest current/upcoming marketing event (name / stage pill / date window / confirmed meetings / open slots — the whole cluster is **clickable**, opening that event's confirmed meetings in the shared `EventMeetingsPane`, the same drawer Client Detail's Marketing Events block uses, fed by the same `loadConfirmedMeetingsByEvent` read), open feedback reports + collections, and an **inline note** saved on blur to `client_todo_notes` (last write wins, never written back to Dynamics). **Row-scoped** by `resolveClientScope` (account-management team), with a "No clients assigned to you" empty state, and enforced again on the note write. Its own independent role grant. Aging colours: touch 60/90 days, upload 120/180 days. **Export to Excel** downloads the current filtered+sorted view as `.xlsx` (ExcelJS, client-side from the already-scoped rows). Requires `sql/20_client_todo.sql`. Full detail in [10 — To-Do List](10-to-do-list.md). |

### Institutions (super-user only)

| Route | Label | Reads | Purpose |
|-------|-------|-------|---------|
| `/institutions` | Institutions | `v_institution_summary` | Directory of all investor institutions met. **"Institutions" is a single clickable top-level nav item** (the category row itself links here — no child rows). Its masthead has a **Finder** link (top-right) to `/institution-style`. |
| `/institution-style` | Finder | `v_institution_style_meetings` | Find institutions by client style (market cap / sector / region). **Not in the nav** — reached from the "Finder" link on the Directory banner. |

### Productivity (super-user only)

| Route | Label | Reads | Purpose |
|-------|-------|-------|---------|
| `/people-statistics` | Statistics | `v_meetings_monthly`, `v_person_role_ttm`, `v_person_activity_windows`, `v_person_feedback_windows` | People-level activity & feedback statistics. |
| `/productivity` | Summary | `v_productivity_person_meeting`, `v_productivity_person_manager_stats`, `salary_schedule`, `cost_assumptions` | Productivity + cost/salary context per person over a chosen date range. |
| `/productivity-detail` | Detail | `v_productivity_detail_summary`, `v_analyst_monthly_activity`, `v_productivity_detail_institutions` | Per-analyst detail and monthly activity. |
| `/capacity` | Capacity | `v_productivity_person_meeting`, `v_capacity_account_roles` ⚠️, `v_person_role_ttm` | Capacity / manager-role coverage across people. |

⚠️ `v_capacity_account_roles` is read by the Capacity page but is **not defined in `sql/03_views.sql`** — it exists in the live database but is missing from the local repo (repo drift). See [04 — Views](04-views.md).

### Logistics (reachable by plain `user` **and** super-user)

| Route | Label | Reads | Purpose |
|-------|-------|-------|---------|
| `/planning-v2` | Planning | `v_planning_events` | Event planning & logistics tracker (current planning tool). |
| `/calendar` | NDRS Calendar | `v_marketing_calendar` | Marketing calendar Gantt. |
| `/scheduler` | Host Calendar | `v_scheduler_meetings`, `v_scheduler_unassigned`, `v_scheduler_time_off` (+ Graph free/busy) | Host availability & scheduling. Also the plain-user home (`USER_HOME_ROUTE`). |
| `/live-outreach` | Live Outreach | `v_live_outreach` | Event outreach board with per-client cards. |
| `/profiles` | Profiles | `v_profiles_upcoming` | Upcoming-meeting profile pipeline board. |
| `/feedback-manager` | Feedback Reports | `v_feedback_pipeline` | The report pipeline — Open (being written) + Pending Review tables with the pipeline-flow KPIs and Claimed By / Account Manager filters. **All-access** (route-gated only, no row scoping). Own "Feedback Reports" banner. |
| `/feedback-collection` | Feedback Collection | `v_feedback_outstanding` | Concluded meetings still needing feedback. **Row-scoped** by the Pass-2 meeting resolver (`resolveMeetingScope`: booker / host / feedback / account-team), with a "No meetings assigned to you" empty-state. Super-users see the Send email / Send test controls (the send route enforces the same gate). Separate route from Reports with its **own independent role grant**. |
| `/feedback` | — (redirect) | — | Redirects to `/feedback-collection`, preserving query params (e.g. the `?client=<id>` deep link). No page of its own. |
| `/onboarding` | Onboarding | `v_client_onboarding` | New-client onboarding checklist tracker. |
| `/time-off` | Time Off | `v_time_off` | OOO / Remote calendar. |

### Contracts (super-user only)

| Route | Label | Reads | Purpose |
|-------|-------|-------|---------|
| `/contract-management` | Contracts | `v_contract_management` | Active contract + renewal tracking per client. **"Contracts" is a single clickable top-level nav item** (the category row itself links here — no child rows). |

### Admin (pinned nav row, super-user only)

| Route | Reads | Purpose |
|-------|-------|---------|
| `/admin` | `sync_runs`, `sync_errors`, `deletion_candidates`, `cron_send_log` (+ table counts) | Admin hub — system-health tiles + links. |
| `/admin/sync` | `sync_runs`, `sync_errors` | Per-entity sync status; "Run sync now" button. |
| `/admin/reconciliation` | `deletion_candidates`, `reconcile_runs` | Review records deleted in Dynamics before they drop. |
| `/admin/database` | `sync_runs`, `sync_errors` (+ row counts) | Mirror-table row counts, watermarks, recent errors. |
| `/admin/docs` | markdown files + live catalog panels | This documentation, in-app. |

### Hidden Pages (linked from Admin, super-user only)

Parked pages — pulled off the main nav but kept reachable from the **Hidden Pages** section on the Admin hub (`dashboard/app/admin/page.tsx`, the `HIDDEN_PAGES` array). Their routes/pages are unchanged; they're super-user-only now because Admin is (and they were removed from `USER_ALLOWED_ROUTES`). Add another parked page with one `{ href, label }` line in `HIDDEN_PAGES`.

| Route | Label | Reads | Purpose |
|-------|-------|-------|---------|
| `/pipeline` | Upcoming Meetings | `v_pipeline_30d`, `v_scheduler_meetings`, `v_scheduler_time_off` | Next-30-days meetings. |
| `/relationships` | Relationships | `v_relationships` | Who at Rose owns each institution relationship. |
| `/conference-rooms` | Conference Rooms | `/api/conference-rooms` (Graph, client-side) | Single-day room availability across the four rooms. |

### Unlinked / hidden routes (super-user only — not in the nav)

These have a `page.tsx` but no sidebar link; reach them by URL.

| Route | Reads | Note |
|-------|-------|------|
| `/` (home) | same as `/client-statistics` | Home = Client Statistics. Plain users are redirected to `/scheduler`. |
| `/planning` | `v_planning_events` | **Old planning page — kept but deliberately unlinked**, superseded by `/planning-v2` (see comments in `nav.tsx` and `access-control.ts`). |
| `/institution-detail` | `v_institution_detail_summary` + `v_institution_detail_*` | One-institution deep-dive (quarterly, top clients, style, hosts). **Route kept but unlinked from the nav** — reached by drilling in from the Directory (`/institutions`), not typed by URL. Still super-user-only (unchanged `USER_ALLOWED_ROUTES`). |
| `/margin` | `v_client_quarterly_pnl` | Client quarterly P&L / margin. |
| `/renewals` | `v_contract_renewals` | Contract renewal calendar. |
| `/exceptions` | `meetings`, `v_meeting_costs`, `v_client_quarterly_pnl`, overhead tables | Data-quality exception report for the cost model. |
| `/cost-assumptions` | `cost_assumptions` | Cost-model assumptions entry. |
| `/direct-costs` | `client_direct_costs` | Client direct-cost entry. |
| `/overhead-overrides` | `overhead_overrides` | Per-account/period overhead overrides. |
| `/quarterly-overhead` | `overhead_periods` | Quarterly overhead totals. |
| `/revenue-overrides` | `revenue_overrides` | Revenue overrides. |
| `/salary-schedule` | `salary_schedule` | Salary schedule maintenance (feeds the cost model). |

### Auth pages (out of the role system)

`/login` and `/auth/*` are public paths handled in `proxy.ts`. `/no-access` is the request-access landing — the only entry in `ALWAYS_ALLOWED_ROUTES`, reachable by any signed-in user including role-less ones.
