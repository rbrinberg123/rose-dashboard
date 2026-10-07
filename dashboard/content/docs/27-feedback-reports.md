# 27 — Feedback reports (event automation, split, FB Coming Soon, Pending Review)

## What it does (plain language)

Every **dashboard-created event** now gets its **feedback report** automatically, and the report moves through its life on its own:

1. **Event created → report created.** The moment an event is created in the dashboard, a **Feedback report** task appears for it: Open, owned by **System** (unclaimed), *feedback not received yet*. Every meeting of the event belongs to it.
2. **Waiting for feedback → FB Coming Soon.** While no feedback has been received, the report is listed on **Logistics → FB Coming Soon** (work in progress, super users only). It **can't be claimed yet**. That page also shows the Dynamics Feedback tasks still waiting on feedback, marked *Dynamics*, read-only.
3. **Feedback received → claimable.** When someone sets the report's **Feedback Received Date** (Tasks page → Edit, for now), it leaves FB Coming Soon and appears on **Feedback Reports**, where a person with the *Claim feedback* permission can claim it (see [14 — Tasks → Feedback claiming](14-tasks.md#feedback-claiming-feedback-reports--claim--release--reassign--close)).
4. **Closed → Pending Review.** When the owner (or an admin) **Closes** the report, a **"Feedback Report Pending Review – <event>"** task is created automatically, due **2 days** later, and the report moves to **Pending Review** on Feedback Reports. The claimer's My Dashboard item clears.

5. **Review done → Close.** On Feedback Reports → **Pending Review**, the **client's account team** (anyone holding one of the six team roles on that client) sees a **Close** button on dashboard rows. It asks *"Mark this feedback report review complete?"*, completes the Pending Review task, and the row leaves Pending Review — the last step for that report.

**Due date.** A report is due **10 days after its last meeting** (Eastern). It's blank until the report has a dated meeting, and it moves by itself as meetings are added, cancelled, re-dated or reassigned.

**Splitting.** Big events can be split into **2 (rarely 3) reports**, each a real Feedback task with its own meetings, owner and due date. Open the event on **CRM → Events**, then the **Feedback reports** panel in its drawer:

- **Split feedback report** creates report B (then C).
- Each meeting has an **A / B / C** selector; **Save assignments** applies them. Every non-cancelled meeting must be in exactly one report.
- New meetings added after a split go to the **latest** report and are marked **"auto-added"** so someone can check them; **Confirm assignments** clears the marker.
- **Delete** removes an *unclaimed, open* report; its meetings go back to another report. The last report can't be deleted. A claimed report keeps whichever meetings are left on it.
- **Cancelled** (or deactivated) meetings belong to no report and don't count toward any due date; if reinstated they rejoin the latest report.

**Scope today:** only events with `origin = 'dashboard'` (use the test client **ZVZZT** to try it). Dynamics events are untouched until cutover.

> **Run first, in order:** `sql/patches/2026-10-07_feedback_claims.sql`, then `sql/patches/2026-10-07b_feedback_report_automation.sql`. Until then FB Coming Soon and the drawer panel say they're switched off.

## Technical

### Data model (dashboard-owned, sync-safe)

| Where | What |
|---|---|
| `public.tasks` (report rows) | A report **is** a dashboard-origin Feedback task: type Outreach, sub-type **Feedback** (755860017), `state_label 'Open'`, `status 'Not Started'`, `scheduled_end` = due (Eastern midnight), `bcs_event_id` / `regarding_id` = the event, `bcs_account_*` = the client, `is_test` inherited from the event, `created_by_name 'System (automation)'`. **`feedback_report_seq`** (1/2/3 = A/B/C) marks it as an automation report; unique per `(bcs_event_id, seq)`. |
| `public.feedback_report_meetings` | `meeting_id` (PK → one report per meeting) · `report_task_id` · `event_id` · `auto_routed` · `assigned_at`. FKs cascade from `meetings` and `tasks`. A mapping table, not a meetings column, so it's sync-safe and works for Dynamics meetings at cutover. |
| `public.tasks` (review rows) | **`review_of_task_id`** on the auto-created review task → the report it reviews (unique: one review task per report). |

None of these columns are written by the Dynamics sync, and dashboard rows are never touched by the sync or the deletion sweep.

### The automations (all in `sql/patches/2026-10-07b_feedback_report_automation.sql`)

| Automation | Mechanism |
|---|---|
| **Auto-create** | `AFTER INSERT ON events` trigger `events_auto_feedback_report` → `feedback_report_create()` (advisory lock per event; lowest free seq; inserts the task + its own `audit_log` row, context `automation:feedback-report:event-created`) → maps the event's eligible meetings → recomputes due. Idempotent: skips if the event already has a report. |
| **Routing + due date** | `AFTER INSERT/UPDATE/DELETE ON meetings` trigger `meetings_feedback_routing`. Ignores updates that don't change `event_id`, `meeting_date`, `meeting_status_label` or `state_label`. Unmaps cancelled / inactive / moved meetings; maps new / reinstated / moved-in ones to `feedback_event_latest_report()` (highest seq, Open first; `auto_routed = true` once the event has ≥ 2 reports); then `feedback_report_recompute_due()` → `scheduled_end = (max meeting day) + 10` at Eastern midnight, Open reports only. Meetings have **no end time**, so "last meeting end" = the latest `meeting_date` (a "+00 wall clock", read as its UTC date). |
| **Close → Pending Review** | `AFTER UPDATE OF state_label ON tasks` trigger `tasks_feedback_close_review` (`WHEN` Feedback → Completed). Inserts the review task: sub-type **Feedback Report Sent** (755860028 — the existing review stage, valid in Dynamics), subject "Feedback Report Pending Review – <event>", Open, due = close day (Eastern, from `actual_end`) + 2, `review_of_task_id` = the report; plus an audit row. Fires for **any** dashboard Feedback task closed — via Feedback Reports' Close or Tasks → Edit. Re-close does nothing; reopening leaves the review task as is. |
| **Split RPCs** | `feedback_report_add`, `feedback_report_set_assignments(event, {meeting: report})`, `feedback_report_delete(report)` — each validates in one transaction (own event only, every eligible meeting once, max 3, unclaimed + open delete, last report kept). EXECUTE revoked from `PUBLIC/anon/authenticated`, granted to `service_role`. Called from `app/events/feedback-report-actions.ts` after `requireCrmWriter` (super user, not "View as"), with `recordAudit` for who asked. |

### `v_feedback_pipeline` — explicit pairing

Pending Review used to pair a Completed Feedback task with an Open Report Sent task by **nearest `created_on` within the event** — which mis-pairs once an event has several reports (a review task created at close time is often nearest to a *different* report). The view now:

- pairs every review task that has `review_of_task_id` with **exactly that report** (`linked`), and
- runs the mutual-nearest heuristic **only** over tasks not in an explicit pair — which is every Dynamics row, so Dynamics behaviour is unchanged;
- shows **per-report** meeting start / end / count for a report with a meeting mapping (otherwise the event's, as before).

Same 20 columns in the same order (`CREATE OR REPLACE`), so `v_client_todo` and every other reader is unaffected.

### Pending Review → Close (`closeFeedbackReview`, `app/feedback-manager/actions.ts`)

Shown on a Pending Review row only when the row's report has an **Open, automation-created review task** (`review_of_task_id` set — i.e. dashboard-origin today; `claims-load.ts` → `reviews`) **and** the viewer is on that client's account team. Server-side, every call re-checks: not in "View as"; the task is sub-type *Feedback Report Sent* with `review_of_task_id`, Open, origin in scope (`isAutomationOrigin` — the same cutover switch as the automations); and the viewer's six-role team scope (`resolveAccountTeamScope`, which for dashboard-created clients reads `account_team_members` via the projection trigger) contains the client resolved **report → event → client**. Anything else gets "Not authorised". **No super-user bypass** (account-team only, by request — adding one is a one-line `|| role === "super_user"` in that check). Completion sets the same native fields as any task completion (Completed / Completed, `actual_end` = now) plus `closed_by_*` / `closed_at`, via a guarded UPDATE that must hit one row; audited as `context = feedback-review:close`. Dynamics "Feedback Report Sent" tasks show no button.

At cutover, Dynamics Pending Review rows are paired by the created-date heuristic and carry no `review_of_task_id`, so the view would also need to expose the paired review task's id (append a `review_task_id` column to `v_feedback_pipeline`) for them to get the button.

### FB Coming Soon (`/fb-coming-soon`)

The feedback-pipeline **working hub**: every Open Feedback task with no `crdfa_feedback_received_date`, from **both origins** (widened 2026-10-07): **Origin** badge (Dashboard / Dynamics — Dynamics rows also say *Managed in Dynamics · not claimable yet*) · Owner (System until claimed) · Client (→ Client Detail) · Event (→ `/events?open=<event_id>`, which opens the drawer) · Report letter (dashboard reports) · Due · Meetings (a mapped report's own meetings; otherwise the event's non-cancelled, active meetings). Work-in-progress banner plus a short how-it-works box.

**Actions** (dashboard rows only; super users, refused in "View as"):

- **Mark received** — a date (default today, Eastern, not in the future) saved as the report's Feedback Received Date plus the legacy Feedback Received flag (`markFeedbackReceived`, `app/events/feedback-report-actions.ts`: `requireCrmWriter`, Open in-scope Feedback task with no received date, guarded one-row UPDATE, audited `feedback-report:mark-received`). The row leaves FB Coming Soon and appears on Feedback Reports, claimable.
- **Open event** (or click the event name) — opens the Events drawer **on this page**. For a dashboard event it carries the Feedback reports panel: **Split feedback report**, A/B/C meeting assignment, delete an unclaimed report, and **Mark received** per report — so a manager can open → split → mark received in one place.
- Dynamics rows: **Open event** only (view-only drawer, no panel) and the note *Managed in Dynamics · not actionable yet*.

**Event filters (both origins).** A task is listed only if its event is **Active** (`events.state_label = 'Active'`), **not** in **Pre-Launch** or **Live Outreach** (`events.event_state_label`), and has **at least one meeting** (non-cancelled, active). Tasks with no linked event are left out. The banner says so, and the subtitle shows how many were hidden.

**Dynamics is display-only.** Nothing on the page claims anything, and nothing touches a Dynamics row; claiming stays on Feedback Reports and dashboard-origin only until cutover; the auto-create stays dashboard-origin only (Dynamics events already create their own Feedback task, so none is duplicated). **Super-user only via `ADMIN_ONLY_ROUTES`** — the one-line flag: remove it there and tick the route in Admin → Roles to open the page to more roles.

### Cutover switch

`feedback_automation_includes_dynamics()` in SQL (authoritative — every trigger asks `feedback_automation_in_scope(origin)`), mirrored by `FEEDBACK_AUTOMATION_INCLUDES_DYNAMICS` in `lib/feedback-reports/policy.ts` (decides whether the drawer offers the panel). Flip **both** at cutover — together with the claim switch `FEEDBACK_CLAIMS_INCLUDE_DYNAMICS` (14 — Tasks). Note: Dynamics events that already exist at cutover won't get a report retroactively (the trigger fires on insert); backfill would be a one-off script.

### Notes

- Events created **before** the patch have no report (the drawer says so).
- Purging test **events** doesn't delete their reports — purge test **tasks** too (reports inherit the test flag).
- Registered on **Admin → Automations** (`lib/automations/registry.ts`).
