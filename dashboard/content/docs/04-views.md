# 04 — Views

## What it does (plain language)

**Views** are the workhorses of the dashboard. A view is a saved query that reshapes the raw mirror tables into exactly the rows and columns a page needs — computing counts, rates, buckets, and rankings so the page itself stays simple.

Every dashboard number comes from a view. If a figure looks off, this catalog tells you which view produces it and what rule it applies, so you know where to look.

All **58** views live in one file: `sql/03_views.sql` (at the repo root). `sql/16_events_table.sql` defines the `events` *table*, not any view. The live list of what exists right now is on the **Admin → Docs** "Views" panel.

> **Reading the catalog:** each view lists its **source** tables, its **consumer** (the page that reads it), and its **key rules**. A handful of views are defined but not read by any page — flagged as *(unused)* below.

---

## Cost & margin

| View | Purpose | Source | Key rules | Consumer |
|------|---------|--------|-----------|----------|
| `v_meeting_costs` | Per-meeting labor cost. | `meetings`, `salary_schedule`, `cost_assumptions` | Booker cost = booker hourly × base hours; host cost adds the in-person multiplier when `is_in_person`; missing-salary exception flags. | `/exceptions` |
| `v_client_quarterly_pnl` | One row per (client, year, quarter): revenue, labor, direct cost, overhead, margin. | `meetings`, `contracts`, direct/overhead/revenue overrides, `v_meeting_costs`, `accounts` | `revenue = contract_revenue + adjustment`; overhead allocated by override else meeting-share; `margin = revenue − labor − direct − overhead`. | `/margin`, `/exceptions` |

---

## Client portfolio & statistics

| View | Purpose | Source | Key rules | Consumer |
|------|---------|--------|-----------|----------|
| `v_client_portfolio` | One row per **active** client — the Portfolio page. | `meetings` (Confirmed), `contracts`, `client_notes`, `accounts` | 365d/90d trailing + `meetings_next_3m` forward counts; market-cap & region CASE buckets; **`note_status` = "last non-blank status wins"** (blank notes filtered before `DISTINCT ON`); `WHERE state_label='Active'`. | `/portfolio` |
| `v_client_statistics` | Three top-line numbers (single row). | `accounts` (active), `contracts` (active) | `annualized_retainer_revenue = SUM(quarterly_retainer × 4)`; average per active client. | `/client-statistics`, `/` |
| `v_client_stats_by_market_cap` | Market-cap buckets for the donut. | `accounts` (active) | Mega/Large/Mid/Small/Micro CASE matching Portfolio; NULL → its own "Unknown". | `/client-statistics`, `/` |
| `v_client_stats_by_region` | Region buckets. | `accounts` (active) | Country ARRAY lists → Americas/EMEA/APAC; unlisted → "Unknown" (Portfolio instead folds unknowns into EMEA). | `/client-statistics`, `/` |
| `v_client_stats_by_sector` | Sector buckets. | `accounts` (active) | `COALESCE(NULLIF(TRIM(sector_label),''),'Unknown')`; count desc, Unknown last. | `/client-statistics`, `/` |
| `v_client_stats_by_manager` | Per primary Account Manager. | `accounts` (active) | Only the **primary** manager counted (each client once); blank → "Unassigned" (sorted last). | `/client-statistics`, `/` |
| `v_client_stats_by_status` | Per client health-status. | `v_client_portfolio` | `bucket = COALESCE(note_status,'No Status')` — built on Portfolio so it can't drift. | `/client-statistics`, `/` |
| `v_client_stats_by_days_left` | Contract days-left buckets. | `v_contract_management` | Buckets on `days_to_expiry` aligned to the Portfolio pill thresholds; NULL/≤0 → "Expired / none". | `/client-statistics`, `/` |

---

## Client detail

| View | Purpose | Source | Key rules | Consumer |
|------|---------|--------|-----------|----------|
| `v_client_detail_summary` | KPI tiles per client. | `accounts`, `meetings` (Confirmed), `contracts` | Lifetime / LTM / prior-12mo counts + delta; `ltm_feedback_rate` = collected ÷ total-closed; `dollars_per_meeting_ltm`; `days_to_renewal` from latest active contract. | `/client-detail` |
| `v_client_detail_quarterly` | ~8 quarters, live vs virtual. | `meetings` (Confirmed) | Split by `is_in_person`; window ≈ last 21 months. | `/client-detail` |
| `v_client_detail_top_institutions` | Top 20 institutions per client. | `meetings` (Confirmed) | `lifetime_count`, `ltm_count`, first/last met; ranked, top 20. | `/client-detail` |
| `v_client_detail_reach_depth` | Institution-depth distribution. | `meetings` (Confirmed) | Per-institution count bucketed 1 / 2-3 / 4-5 / 6-10 / 10+, then counts institutions per bucket. | `/client-detail` |
| `v_client_detail_institutions` | Full per-client institution list. | `meetings` (Confirmed) | Same as reach_depth without the top-20 cap; backs the drawer. | `/client-detail` |
| `v_client_detail_top_hosts` | Top 5 hosts per client (LTM). | `meetings` (Confirmed, 12m) | Grouped by host **name**; excludes "CRM Administration". | `/client-detail` |
| `v_client_detail_recent_meetings` | Last 25 meetings per client. | `meetings` (Confirmed) | `ROW_NUMBER` ≤ 25, most recent first. | `/client-detail` |
| `v_client_detail_recent_note` | The client's newest note (may be blank). | `client_notes` | Ranked `note_date, modified_on, created_on`; `rn=1`. **Does NOT carry forward** a blank status (unlike Portfolio). | `/client-detail` |
| `v_client_detail_active_contract` *(unused)* | Most recent active contract w/ term math. | `contracts` | Parses `term_months`; rolls auto-renewed terms forward via `generate_series`. | — |
| `v_client_detail_touchpoints` *(unused)* | All touchpoints for a client. | `touchpoints` | The page reads the **base `touchpoints` table** directly instead. | — |

---

## Institutions

| View | Purpose | Source | Key rules | Consumer |
|------|---------|--------|-----------|----------|
| `v_institution_summary` | One row per institution met. | `meetings` (Confirmed) | Lifetime/LTM/prior counts, unique clients/people; flags `is_active` (met <12m), `is_cold` (>24m), `is_heavy_hitter` (lifetime ≥10). | `/institutions`, `/institution-detail` |
| `v_institution_detail_summary` | KPI tiles per institution. | `meetings` (Confirmed) | Lifetime/LTM meetings + delta, clients & people, `ltm_feedback_rate`; last-met client/host. | `/institution-detail` |
| `v_institution_detail_quarterly` | ~8 quarters, live vs virtual. | `meetings` (Confirmed) | Split by `is_in_person`. | `/institution-detail` |
| `v_institution_detail_top_clients` | Top 10 Rose clients per institution. | `meetings` (Confirmed) | Ranked by lifetime count, top 10. | `/institution-detail` |
| `v_institution_detail_style` | Clients met, by market-cap/sector/region. | `meetings` (Confirmed), `accounts` | Each client counted once per institution; three UNION ALL branches. | `/institution-detail` |
| `v_institution_detail_top_hosts` | Top 5 hosts per institution (LTM). | `meetings` (Confirmed, 12m) | Grouped by host **name**; excludes "CRM Administration". | `/institution-detail` |
| `v_institution_detail_recent_meetings` | Last 25 per institution. | `meetings` (Confirmed) | `ROW_NUMBER` ≤ 25. | `/institution-detail` |
| `v_institution_style_meetings` | Confirmed meetings joined to client style. | `meetings` (Confirmed), `accounts` (LEFT) | Reuses the Client-Statistics CASE buckets; `is_ltm` flag; used for client-side ranking. | `/institution-style` |

---

## Productivity & people

Most of these fold **duplicate Dynamics user GUIDs** into one person via `canonical_user_id()` (backed by `user_id_aliases`), and count **Confirmed** meetings only over a trailing-12-month (Eastern-time) window.

| View | Purpose | Source | Key rules | Consumer |
|------|---------|--------|-----------|----------|
| `v_productivity_detail_summary` | Per-person productivity detail. | `meetings`, `users`, `accounts`, `contracts`, `canonical_user_id()` | Confirmed-only 12m counts; `feedback_collection_rate_12m` = collected ÷ **closed** (not ÷ hosted); folds duplicate ids; excludes "CRM Administration". | `/productivity-detail` |
| `v_person_role_ttm` | Host/Booker/Hybrid role totals. | `meetings`, `canonical_user_id()` | `booked_ttm`/`hosted_ttm`/`total_ttm` (Confirmed, 12m). | `/people-statistics`, `/capacity`, `/productivity` |
| `v_analyst_monthly_activity` | Per-person monthly bars (12m). | `meetings`, `users` | Aggregates by **display name** (name-merge caveat); Confirmed only. | `/productivity-detail` |
| `v_productivity_detail_institutions` | Per-person, per-institution (12m). | `meetings` (Confirmed), `canonical_user_id()` | `booked_count` / `hosted_count` via FULL OUTER JOIN. | `/productivity-detail` |
| `v_productivity_person_meeting` | One row per (user, meeting, role) — up to 2 per meeting. | `meetings`, `salary_schedule`, `cost_assumptions`, `users`, `canonical_user_id()` | `attributed_cost` per role; UNION of booker + host; app aggregates over a chosen date range. | `/productivity`, `/capacity` |
| `v_productivity_person_manager_stats` | Primary vs secondary manager counts. | `accounts`, `users`, `canonical_user_id()` | Includes all users (zero where unassigned). | `/productivity` |
| `v_meetings_monthly` | Firm-wide meetings by month (48m). | `meetings` (Confirmed) | `virtual_count`/`live_count`/`total` by `is_in_person`. | `/people-statistics` |
| `v_person_activity_windows` | Booked vs hosted, 30d & 12m. | `meetings` (Confirmed), `users`, `canonical_user_id()` | Eastern windows; `_1y` equals `v_person_role_ttm` by construction. | `/people-statistics` |
| `v_person_feedback_windows` | Host feedback completion, 30d/12m + prior year. | `meetings` (Confirmed), `users`, `canonical_user_id()` | `collected` = "Closed - All in"; `assigned` = closed-set; rate = collected ÷ assigned. | `/people-statistics` |
| `v_analyst_activity` *(unused)* | Productivity by user by quarter. | `meetings`, `users`, `v_meeting_costs` | Superseded by the newer productivity views. | — |

---

## Feedback

| View | Purpose | Source | Key rules | Consumer |
|------|---------|--------|-----------|----------|
| `v_feedback_outstanding` | **Collection** tracker: concluded meetings whose feedback isn't closed. | `meetings` (Confirmed, Active), `accounts` | Incomplete = `feedback_status_label IS NULL` OR "Awaiting Additional"; only meetings whose Eastern date is **before** Eastern today; responsible person from `_raw->>'_bcs_feedback_value'` then host. | `/feedback` |
| `v_feedback_pipeline` | **Report-production** pipeline (two categories). | `tasks` (Feedback + Report Sent), `meetings`, `accounts` | `event_key = COALESCE(regarding_id, bcs_event_id)`; `in_progress` = Feedback task open + received; `pending_review` = completed Feedback paired to one open Report Sent. | `/feedback-manager`, `/feedback` |
| `v_feedback_manager` *(unused)* | Older per-event feedback concept. | `tasks`, `meetings` | **Superseded by `v_feedback_pipeline`** — the page now reads pipeline. | — |
| `v_feedback_by_client` *(unused)* | Feedback rate per client per quarter. | `meetings` | Rate = feedback ÷ non-cancelled. | — |
| `v_feedback_by_analyst` *(unused)* | Feedback rate per host per quarter. | `meetings` | — | — |
| `v_feedback_overall` *(unused)* | Firm-wide feedback rate per quarter. | `meetings` | — | — |

> Outstanding vs pipeline is a common point of confusion — see the side-by-side in [07 — Business Rules](07-business-rules.md).

---

## Logistics (scheduler, pipeline, planning, calendar, outreach, onboarding, time-off, relationships)

| View | Purpose | Source | Key rules | Consumer |
|------|---------|--------|-----------|----------|
| `v_scheduler_meetings` | Confirmed, hosted meetings w/ real start times. | `meetings` (Confirmed), `accounts` | Times read as stored **wall-clock** via `AT TIME ZONE 'UTC'` (deliberately not shifted); excludes NULL host & "CRM Administration". | `/scheduler`, `/pipeline` |
| `v_scheduler_unassigned` | Upcoming Confirmed meetings with **no host**. | `meetings` (Confirmed, host NULL), `accounts` | `host_id IS NULL AND date ≥ today`. | `/scheduler` |
| `v_scheduler_time_off` | Approved OOO/Remote for people who host. | `v_time_off`, `meetings` | Built on `v_time_off`; joined to hosts strictly **by id**. | `/scheduler`, `/pipeline` |
| `v_pipeline_30d` | Meetings in the next 30 days. | `meetings` | `days_until` from today; excludes Cancelled; Active only. | `/pipeline` |
| `v_planning_events` | Confirmed meetings of upcoming **events**. | `meetings` (Confirmed, event not null), `accounts` | Grouped by `event_id`; "upcoming" = event has ≥1 future confirmed meeting; `is_past` flag; exposes logistics columns (`sent`/`confirm`/`driver`/`food_order`/`logistics_notes`). | `/planning`, `/planning-v2` |
| `v_profiles_upcoming` | Upcoming-meeting profile board (3 business weeks). | `meetings`, `accounts`, `events` | `week_index` from a Monday anchor (weekend → next Monday); business days only; excludes Cancelled. | `/profiles` |
| `v_marketing_calendar` | Events for the calendar Gantt. | `events`, `accounts` | Active + workflow state not "Pause" + recent/upcoming; `event_dates` is free text. | `/calendar` |
| `v_live_outreach` | Events in the "Live Outreach" state. | `events`, `accounts`, `client_notes`, `contracts`, `meetings` | `slots_remaining = of_slots − confirmed`; `event_mode` from `event_location` text; `client_status_label` via the same carry-forward as Portfolio; `is_new_client` = earliest contract within 6 months. | `/live-outreach` |
| `v_client_onboarding` | Active clients with incomplete onboarding steps. | `accounts` (active) | 9 step flags; `filled_count < 9`; scoped to `onboarding_start_date ≥ 2026-01-01`. | `/onboarding` |
| `v_time_off` | Approved time-off entries. | `new_vacationrequest`, `meetings` | `time_off_type` = Remote when request type is "Remote Work" else OOO; **no approval filter** (all treated approved); `is_host` if requester ever hosts. | `/time-off` |
| `v_relationships` | Who owns each institution relationship. | `meetings` (Confirmed) | `host_pct`/`booker_pct` per person; top hosts/bookers as JSON arrays; `next_meeting_date`; `meeting_weeks` JSON. | `/relationships` |
| `v_client_marketing_status` *(unused)* | Per-client event + report lifecycle. | `events`, `meetings`, `tasks`, `accounts` | Defined but has no `.from()` consumer (referenced only in a type comment). | — |

---

## Missing from the repo (repo drift)

`v_capacity_account_roles` is queried by `/capacity` (`app/capacity/page.tsx`) but is **not defined in `sql/03_views.sql`**. It exists in the live database; the local SQL is out of date. If you rebuild the schema from `sql/` alone, this view (and possibly others) won't be recreated. The **Admin → Docs "Views" panel** is the definitive live list — trust it over the file.

## Recurring conventions worth knowing

- **"Confirmed only"** — nearly every meeting count filters `meeting_status_label = 'Confirmed'`. A few older views instead exclude Cancelled. See [07](07-business-rules.md).
- **Eastern time** — trailing-window views compute "today" in `America/New_York`, not UTC.
- **Name-merge caveat** — a few views group by person *name* rather than canonical id; noted per view above.
- **`_raw` reads** — some columns come straight from the JSONB payload (`_raw->>'...'`) rather than a modeled column.
