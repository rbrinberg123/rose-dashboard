# Admin UI Specification

This document describes the admin pages the Next.js dashboard needs to support
cost data entry. Claude Code will use this as the blueprint for the admin
section of the dashboard.

The dashboard otherwise reads from views (`v_*`); these admin pages are the
only places where users WRITE to the database. Writes go to Rose-owned tables:
`salary_schedule`, `cost_assumptions`, `client_direct_costs`,
`overhead_periods`, `overhead_overrides`, `revenue_overrides`.

## Page index

1. **Cost Assumptions** — set the per-meeting hour and multiplier parameters
2. **Salary Schedule** — manage staff compensation over time
3. **Direct Client Costs** — log T&E, event fees, ad-hoc charges
4. **Quarterly Overhead** — set the total overhead pot per quarter
5. **Overhead Overrides** — direct allocation to specific clients
6. **Revenue Overrides** — manual adjustments to contract-derived revenue
7. **Exception Report** — clients/meetings with missing cost data

---

## 1. Cost Assumptions

A single-row settings page. Always exactly one row in `cost_assumptions`.

**Fields (all editable):**
- Work hours per year (default 2000)
- Booker hours per meeting, base (default 0.5)
- Host hours per meeting, base (default 1.5)
- In-person multiplier (default 2.0)
- Default benefits multiplier (default 1.15) — used as the suggested value when
  adding a new salary schedule entry, but each salary row stores its own
  multiplier.

**Behavior:**
- Single form with five number inputs.
- "Save" button updates the single row. No insert, only update.
- After save, show a confirmation: "Cost assumptions updated. Per-meeting costs
  will recalculate automatically."

**Worth noting:** Changes here cause every meeting's cost to be re-derived on
the next view query. There's no need to "rerun" anything.

---

## 2. Salary Schedule

The most active admin page — used whenever someone joins, leaves, or gets a
raise.

**View (table):**
- Columns: User name, Effective from, Effective to, Annual salary, Annual bonus,
  Benefits multiplier, Fully-loaded annual cost (computed), Notes, Actions
- Default sort: User name, then Effective from descending
- Filter by user (dropdown of users from `users` table) and by "active periods only"
- Group rows by user with collapsible sections (one user, multiple periods)

**Add / Edit form:**
- User: dropdown of users (search by display_name)
- Effective from: date
- Effective to: date (optional; "currently active" if blank)
- Annual salary: number, ≥ 0
- Annual bonus: number, ≥ 0 (default 0)
- Benefits multiplier: number, > 0 (default 1.15)
- Notes: textarea (optional)

**Validation:**
- Effective_to must be ≥ effective_from when set
- No overlapping periods for the same user (DB enforces this; UI should catch
  early and show a helpful error: "User already has a salary record covering
  this period: <range>")

**Common workflow — recording a raise:**
1. Find the user's current row (effective_to = NULL).
2. Edit it, set effective_to = (date before raise effective).
3. Add a new row with effective_from = (date raise takes effect), new salary.

This is a known awkward UX. If desired, add a "Record raise" shortcut that does
both steps in one form: takes new salary, new effective_from, and automatically
truncates the previous row.

---

## 3. Direct Client Costs

Form-driven entry of T&E, event fees, etc. Append-only — no edits, but allow
deletion of mistakes.

**View (table):**
- Columns: Date, Client, Category, Amount, Description, Created by, Created at, Actions
- Sort: Date descending
- Filters: Client (dropdown), Category (dropdown), Date range
- Footer row: Total amount of filtered results

**Add form:**
- Date: date picker, default today
- Client: searchable dropdown of accounts (from `accounts.name`)
- Category: dropdown — T&E, Event Fee, Sponsorship, External Research, Other
- Amount: number, ≥ 0
- Description: textarea (optional)

**Behavior:**
- "Save and add another" button to streamline bulk entry.
- After save, the row appears at top of the table.

**Bulk import (nice-to-have, defer to v2):** paste CSV with date, client name,
category, amount, description. Resolves client name to ID via fuzzy match.

---

## 4. Quarterly Overhead

One row per quarter. Set the total overhead pot to allocate.

**View (table):**
- Columns: Year, Quarter, Total overhead, Notes, Updated at
- Sort: Year desc, Quarter desc
- One row per (year, quarter) — UNIQUE in DB

**Add / Edit form:**
- Year: number, ≥ 2020
- Quarter: 1, 2, 3, or 4
- Total overhead amount: number, ≥ 0
- Notes: textarea

**Validation:**
- Cannot create duplicate (year, quarter)
- If editing: warn if changing the total when overrides exist for that quarter
  ("Changes will affect overhead allocation across N clients")

---

## 5. Overhead Overrides

Direct allocation to specific clients per quarter. Used for advisory-only clients.

**View (table):**
- Columns: Year, Quarter, Client, Type (Fixed $ / Percent), Amount/Percent,
  Resolved $ (computed), Notes, Actions
- Sort: Year desc, Quarter desc, Client
- Filter by year, quarter, client

**Add / Edit form:**
- Year, Quarter
- Client: searchable dropdown
- Override type: radio — "Fixed dollar amount" / "Percent of total overhead"
- If fixed: Amount (number, ≥ 0)
- If percent: Percent (0.0–1.0, displayed as percentage 0–100%)
- Notes

**Validation:**
- Exactly one of fixed_amount or percent_of_total set (DB enforces)
- Cannot create duplicate (client, year, quarter)
- If percent: warn if total of all percent overrides for the quarter exceeds 100%
- If fixed: warn if total of all fixed overrides exceeds the quarter's
  total_overhead_amount (this leaves negative remainder for meeting-share clients)

---

## 6. Revenue Overrides

Manual adjustments to contract-derived revenue.

**View (table):**
- Columns: Year, Quarter, Client, Adjustment amount (signed), Reason, Created at
- Sort: Year desc, Quarter desc

**Add form:**
- Year, Quarter
- Client: searchable dropdown
- Adjustment amount: signed number (positive = add revenue, negative = subtract)
- Reason: text, required

No edit; if wrong, delete and re-add. Append-only for audit clarity.

---

## 7. Exception Report

Read-only page that surfaces data quality issues that affect the cost model.

**Sections:**

**A. Meetings with missing booker or host:**
Query: meetings where booker_id is NULL or host_id is NULL.
Show: meeting_date, client, institution, missing role(s).
Action prompt: "Fix in Dynamics, then run sync."

**B. Meetings with users not in the salary schedule:**
Query: v_meeting_costs where booker_missing_salary OR host_missing_salary.
Show: meeting_date, user name, role (booker/host), client, est. cost loss.
Action prompt: "Add a salary schedule entry for this user covering this meeting date."

**C. Clients with revenue but no meetings AND no overhead override (current quarter):**
Query: v_client_quarterly_pnl where has_no_overhead_alloc = true.
Show: client, current quarter revenue, current quarter margin.
Action prompt: "Add an overhead override for this advisory-only client."

**D. Quarters with overhead overrides exceeding total pot:**
Query: SUM(override_amount) > total_overhead_amount for any (year, quarter).
Show: year, quarter, total pot, overrides total, overrun amount.
Action prompt: "Increase overhead pot or reduce overrides."

**E. Meetings with NULL meeting_type (default to virtual; cost may be understated):**
Query: meetings where meeting_type_label IS NULL.
Show: meeting_date, client, host, booker.
Action prompt: "Set meeting type in Dynamics for accurate cost."

---

## Navigation structure

The Next.js dashboard sidebar should look like:

```
Dashboards
  Client Portfolio
  Analyst Activity
  Feedback Discipline
  Pipeline (Next 30 Days)
  Contract Renewals
  Margin by Client

Admin
  Cost Assumptions
  Salary Schedule
  Direct Costs
  Quarterly Overhead
  Overhead Overrides
  Revenue Overrides
  Exception Report
```

The Admin section should be visually separated (different sidebar group) so
viewers don't accidentally enter cost data. Consider gating with a role flag
later (Supabase RLS); not required for v1.

---

## Tech stack notes for Claude Code

- **Framework:** Next.js (App Router) + TypeScript
- **DB client:** Supabase JS client (`@supabase/supabase-js`) — use the
  `service_role` key for server-side reads/writes; `anon` key for client-side
  reads if you go that route. For an internal tool with no auth, server-side
  with service_role is simplest.
- **UI library:** shadcn/ui (built on Radix + Tailwind) — already standard for
  Claude Code projects, gives clean tables/forms/dialogs out of the box.
- **Tables:** TanStack Table (`@tanstack/react-table`) for sortable/filterable views.
- **Forms:** react-hook-form + zod for validation.
- **Dates:** date-fns for formatting.
- **Charts:** Recharts for the dashboard surfaces.

The reader views (Client Portfolio, Analyst Activity, etc.) are SELECT-only —
just fetch from the `v_*` views and render. The admin pages are forms that
INSERT/UPDATE/DELETE on the Rose-owned tables.

For an internal-only tool, skip auth in v1. Add Supabase Auth if/when the app
is exposed beyond Rose's office network.
