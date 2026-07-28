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
| `/portfolio` | Portfolio | `v_client_portfolio` (+ `v_contract_management`) | Active-client roster with health status and contract linkage. |
| `/client-detail` | Detail | `v_client_detail_summary` + many `v_client_detail_*` (+ base `touchpoints`) | Deep-dive on one client: quarterly, institutions, hosts, recent meetings/notes. |

### Institutions (super-user only)

| Route | Label | Reads | Purpose |
|-------|-------|-------|---------|
| `/institutions` | Directory | `v_institution_summary` | Directory of all investor institutions met. |
| `/institution-detail` | Detail | `v_institution_detail_summary` + `v_institution_detail_*` | One-institution deep-dive: quarterly, top clients, style, hosts. |
| `/institution-style` | Finder | `v_institution_style_meetings` | Find institutions by client style (market cap / sector / region). |

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
| `/feedback` | Feedback Collection | `v_feedback_outstanding` (+ `v_feedback_pipeline`) | Outstanding meeting feedback to collect. |
| `/feedback-manager` | Feedback Report Pipeline | `v_feedback_pipeline` | Two-category feedback-report pipeline. |
| `/pipeline` | Upcoming Meetings | `v_pipeline_30d`, `v_scheduler_meetings`, `v_scheduler_time_off` | Next-30-days meetings. |
| `/onboarding` | Onboarding | `v_client_onboarding` | New-client onboarding checklist tracker. |
| `/relationships` | Relationships | `v_relationships` | Who at Rose owns each institution relationship. |
| `/conference-rooms` | Conference Rooms | `/api/conference-rooms` (Graph, client-side) | Single-day room availability across the four rooms. |
| `/time-off` | Time Off | `v_time_off` | OOO / Remote calendar. |

### Contracts (super-user only)

| Route | Label | Reads | Purpose |
|-------|-------|-------|---------|
| `/contract-management` | Management | `v_contract_management` | Active contract + renewal tracking per client. |

### Admin (pinned nav row, super-user only)

| Route | Reads | Purpose |
|-------|-------|---------|
| `/admin` | `sync_runs`, `sync_errors`, `deletion_candidates`, `cron_send_log` (+ table counts) | Admin hub — system-health tiles + links. |
| `/admin/sync` | `sync_runs`, `sync_errors` | Per-entity sync status; "Run sync now" button. |
| `/admin/reconciliation` | `deletion_candidates`, `reconcile_runs` | Review records deleted in Dynamics before they drop. |
| `/admin/database` | `sync_runs`, `sync_errors` (+ row counts) | Mirror-table row counts, watermarks, recent errors. |
| `/admin/docs` | markdown files + live catalog panels | This documentation, in-app. |

### Unlinked / hidden routes (super-user only — not in the nav)

These have a `page.tsx` but no sidebar link; reach them by URL.

| Route | Reads | Note |
|-------|-------|------|
| `/` (home) | same as `/client-statistics` | Home = Client Statistics. Plain users are redirected to `/scheduler`. |
| `/planning` | `v_planning_events` | **Old planning page — kept but deliberately unlinked**, superseded by `/planning-v2` (see comments in `nav.tsx` and `access-control.ts`). |
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
