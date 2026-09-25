# 23 — Time Off (requests & approvals)

> **Status: built, local only.** Needs `sql/patches/2026-09-24_time_off_requests.sql` run in Supabase before the page loads. **Super-user only for now.**

## What it does (plain language)

**CRM → Time Off** (`/time-off-requests`) is the one list of every time-off request:

- the **Dynamics history** — every request synced from Dynamics (`new_vacationrequest`). Read-only, always; and
- **requests made in the dashboard**, which go through a simple workflow: **Pending → Approved** or **Denied**.

Each person has a small **reviewing team** — the people allowed to approve or deny their time off — set on **Admin → Time Off Reviewers**. A new request lands on each reviewer's **Alerts** page until one of them decides it. Once **approved**, it shows as Approved on the Time Off list and is counted on the **OOO Summary**.

Not to be confused with **Logistics → Time Off** (`/time-off`), the who's-out calendar. That page still reads only the Dynamics history (`v_time_off`) and is unchanged.

### How to use it

1. **Set up reviewers first.** Admin → Time Off Reviewers: for each person, pick one or more reviewers. A person can't review their own time off. Changes apply immediately.
2. **Create a request.** CRM → Time Off → **Add New Time Off** (or the CRM "+" menu → **New Time Off**). Pick who it's for (defaults to you), the type, and the start and end dates. Every day in the range is listed: each working day starts as **Full** and can be switched to **½ AM** or **½ PM**. Weekends and stock-market holidays are shown greyed as "not counted". The running **Total** updates as you go (e.g. 2.5 days). The reviewing team is shown under it. **Test record** is ticked by default.
3. **Approve or deny.** Either open the request's drawer on the Time Off page, or use the **Time Off Approvals** section at the top of your Alerts page. Add an optional comment and click **Approve** or **Deny**.
4. **Fix or remove a request.** In the drawer, a super-user can **Edit** (any field — dates, halves, type, person, text) or **Delete** a dashboard request, whatever its status.

---

## Who can do what

| Action | Who | Enforced where |
|---|---|---|
| Open the page / admin page | super_user | proxy (`ADMIN_ONLY_ROUTES`), the page itself, and every server action |
| Create a request | super_user, not in "View as" | `createTimeOffRequest` → `requireCrmWriter` |
| **Edit / delete** a dashboard request (any status) | **super_user only**, not in "View as" | `updateTimeOffRequest` / `deleteTimeOffRequest` → `requireCrmWriter` |
| Approve / deny | super_user, not in "View as", **on the requester's reviewing team right now**, not the requester, request still Pending | `reviewTimeOffRequest` |
| Change reviewing teams | super_user, not in "View as" | `app/admin/time-off-reviewers/actions.ts` |
| Dynamics rows | nobody — read-only history | the actions only accept `origin = 'dashboard'` rows |

**The requester can never edit or delete a request — not their own, not ever.** Being the requester grants nothing; only the super_user check opens edit/delete. This is checked **server-side** in the actions, not by hiding buttons, and is meant to hold when access is broadened later: requesters will *submit*, super-users *edit/delete*.

**Status is not editable through Edit.** It changes only through Approve / Deny, which is what checks the reviewing team. Editing an approved request leaves it Approved.

**"View as".** The Alerts section honours View as, so viewing as a reviewer shows exactly what they'd see. The buttons are disabled while impersonating ("Exit View as…"), and the server refuses anyway — the reviewer recorded is always the **real** person.

---

## The per-day half-day model

A request is a date range **plus one `time_off_days` row per counted day**, each with a portion: **Full** (1), **AM** or **PM** (½). `total_days` = the sum.

- **Which days count** is the OOO Summary's own rule (`isBusinessDay`): Monday–Friday and not an NYSE holiday. Weekends/holidays inside a range get no day row. So a request's total here and its count on the OOO Summary always agree.
- `total_days` and the day rows are written **only** by the database function `public.time_off_set_days(request_id, days)`, which replaces the rows and re-derives the total in **one transaction**. Create and edit both call it, so they can never drift apart.
- Editing dates or halves re-derives both. Deleting a request **cascades** to its days.

### Dynamics rows

Dynamics has no usable day count (`duration` is minutes, and 0 for a one-day request) and no half-day field. The Time Off list shows the **same number the OOO Summary computes** for them: business days, with the comment-based half-day rule (see [11 — OOO Summary](11-ooo-summary.md)). Dynamics never fills its request status, so every synced request shows as **Approved** (the same rule as `v_time_off`). Its Reviewing Team is the Dynamics team name ("Time Off Requests").

---

## Alerts integration

**Clients → Alerts** gets a **Time Off Approvals** section at the top, shown only to people who are on at least one reviewing team. It lists **Pending** dashboard requests whose requester has the viewer on their team, earliest first, with inline Approve / Deny.

It is an **action-needed (blue, informational)** section: it is **not** counted in the Critical tile or the red nav badge, which stay feedback-only. *(Open question: it may deserve its own small count on the nav — not added.)*

## OOO Summary integration

`/ooo-summary` now adds **Approved** dashboard requests to the Dynamics history before tallying, using their exact day rows — so a ½ AM day counts 0.5 exactly, rather than via the comment heuristic. Pending and Denied requests never count. **Test requests are not filtered** — an approved test request is counted until it's deleted with "Delete test requests".

## Dates

Every date is an **Eastern calendar day**, stored as a plain `date` (no time, no zone). Nothing converts it, so nothing can shift it.

---

## Technical

### Tables (dashboard-owned — not Dynamics mirrors)

| Table | What |
|---|---|
| `time_off_requests` | One row per request. `request_type` ∈ Vacation / Sick Leave / Personal / Jury Duty / Remote Work / Other; `status` ∈ Pending / Approved / Denied; `reviewed_by_*`, `reviewed_at`, `review_comments`; `origin` = 'dashboard'; `is_test`; `created_by_*`, `created_on`, `modified_on`. |
| `time_off_days` | One row per counted day: `request_id` (FK, `ON DELETE CASCADE`), `off_date`, `portion` ∈ Full / AM / PM. Unique per (request, day). |
| `time_off_reviewers` | `person_user_id` → `reviewer_user_id`. Several rows per person = their team. Unique per pair. |

People are `public.users.user_id` (the Dynamics id space), so a person's dashboard and Dynamics time off group together on the OOO Summary. People with duplicate CRM records are handled: every reviewer check widens a person to all their ids (`lib/time-off-requests/reviewers.ts`).

These are not mirrors, so the sync and deletion sweep never touch them and they need no origin fence. `origin` is still stamped so the shared test purge and the Audit Log's origin badge work. RLS on, no policies: only the service role reaches them.

### View

`v_admin_time_off_all` = Dynamics `new_vacationrequest` `UNION ALL` `time_off_requests`, with a `source` column ('Dynamics' / 'Dashboard'). For dashboard rows, `reviewing_team` is the requester's **current** reviewers, resolved live.

### Files

| File | Role |
|---|---|
| `sql/patches/2026-09-24_time_off_requests.sql` | Tables, `time_off_set_days()`, the view |
| `app/time-off-requests/page.tsx` | Gate + load; fills Dynamics day counts |
| `app/time-off-requests/actions.ts` | Every write + the drawer read; **all the rules** |
| `app/time-off-requests/time-off-requests-view.tsx` | Virtualized list, filters (type / status / source / person + keyword), drawer |
| `app/time-off-requests/time-off-form-dialog.tsx` | Create / edit form with the per-day picker; purge button |
| `app/time-off-requests/review-controls.tsx` | Approve / Deny (drawer + Alerts) |
| `app/admin/time-off-reviewers/*` | Reviewer assignment page |
| `app/clients/alerts/load.ts`, `time-off-approvals-section.tsx` | The Alerts section |
| `app/ooo-summary/page.tsx`, `lib/ooo-summary/compute.ts` | The OOO integration (`days` on `OooRequest`) |
| `lib/time-off-requests/model.ts` | Types, the six types, per-day builder, totals |
| `lib/time-off-requests/reviewers.ts` | Who reviews whom (fails closed) |

### Audit

Every write calls `recordAudit`: create (full snapshot incl. days), approve / deny (status + reviewer diff), edit (before → after diff, days as "2026-11-03 AM, …" and `total_days`), delete (snapshot), test purge (one entry per row), and reviewer add / remove. Entities: `time_off_requests`, `time_off_reviewers`.

### Test data

"Test record" defaults **on** (`NEW_TIME_OFF_TEST_DEFAULT` in `lib/time-off-requests/model.ts`). Test rows show a TEST badge. **Delete test requests** removes every `origin='dashboard' AND is_test` request (days cascade), audited. Going live = set the default to `false`.
