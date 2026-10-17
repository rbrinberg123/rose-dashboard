# 26 — My Dashboard

## What it does (plain language)

**My Dashboard** (`/my-dashboard`) is the personal home page: one screen with everything on *your* plate across the clients you're on the account team for. It's the first item in the sidebar and where you land after signing in.

**Open to every signed-in user** (2026-10-08; was super-user only from 2026-10-07). `/my-dashboard` is in `ALWAYS_ALLOWED_ROUTES` (`lib/access-control.ts`), so it shows in everyone's nav and needs no Roles-matrix grant (it's no longer listed in the matrix). An account with **no role yet** is still sent to `/no-access` (the page checks). **Default homepage (2026-10-08):** every user with a role lands on My Dashboard after signing in, from `/login` when already signed in, **and at the app root `/`** (`app/page.tsx` → `homeRouteFor()`: My Dashboard, else Portfolio, else the first page the role can open, else `/no-access`; Client Statistics stays at `/client-statistics`); a role-less user goes the old Portfolio → `/no-access` way (`landingRouteFor`, used by the auth callback, `/login` and `proxy.ts`). **To make it super-user only again:** move the route to `ADMIN_ONLY_ROUTES` — nav and landing follow automatically.

**Per-feed permissions.** No feed depends on the viewer's role: every query runs server-side with the service-role key and is filtered to the viewer's own ids or account teams (table below), so a normal user's dashboard is fully populated without any extra grant, and never shows anyone else's items. Role only affects **where a row goes when clicked**:

- **Task drawer** is offered only to viewers who can open CRM → Tasks (super users today — `loadTaskRecord` is super-user only and CRM → Tasks is unscoped); everyone else clicks through to the row's link. **Meeting drawer** (Hosting rows) opens for **every** viewer through `loadHostedMeetingRecord` (`app/meetings/actions.ts`), which returns a meeting only if the viewer **hosts** it — the Hosting card's own scope — and refuses anything else; its Edit button stays super-user only.
- **Time-off drawer** (Time Off Approvals rows) opens for **every** viewer through `loadTimeOffApprovalRecord` (`app/time-off-requests/actions.ts`) — only for a request whose requester you review — and is the same drawer as CRM → Time Off, with **Approve / Deny** (`ReviewControls` → `reviewTimeOffRequest`). **Inline Approve / Deny (2026-10-08):** each row also carries **Approve** (one click + an inline **Confirm**) and **Deny** (never instant — opens an inline prompt that **requires a reason**, saved as the review comment). Both are optimistic (row disappears at once; restored with an error toast if refused), call the same `reviewTimeOffRequest`, and on success refresh the page so the card, the "critical" pill and the nav badge recount. Buttons are hidden in "View as"; the server enforces who may act (reviewing team, not the requester, not in View as) and refuses anyone else with "Not authorised". Clicking the row itself still opens the full drawer (`TimeOffApprovalRow` in `time-off-drawer.tsx`).
- **Inline cards for Feedback to Collect, Active Marketing and Onboarding (2026-10-10).** Clicking a row on these three cards opens the record as a drawer on the dashboard, instead of navigating away. Closing it returns to the same place, and each card's **All →** still goes to the full page. Every loader is gated server-side to the card's own scope; super users pass.
  - **Feedback to Collect → meeting drawer.** This is the existing `MeetingDrawerHost` (`MeetingRecordPane`). `loadHostedMeetingRecord` now admits a meeting you host **or** one whose outstanding feedback is yours to collect (`v_feedback_outstanding.host_id` ∈ me), which is this card's exact scope.
  - **Active Marketing → event drawer.** This is the existing `EventRecordPane`, hosted by `event-drawer.tsx`, opening the Live Outreach event the row is built from. Its loader is `loadDashboardEventRecord` (`app/events/actions.ts`), which only returns an event in `v_live_outreach` whose client is on your account team. The drawer is read-only here. Its Feedback reports panel shows only for super users (`showFeedbackReports`), because that panel's loader is super-user only.
  - **Onboarding → onboarding card (new).** There was no onboarding detail component to reuse; the Onboarding page is one table. `onboarding-drawer.tsx` is a compact, read-only drawer in the same shell as the record drawers. Top to bottom it shows: a compact strip of date chips (onboarding start, contract start, first event); the nine steps (done or not, with dates for the three dated ones, from the Onboarding page's own `STEPS`); then the onboarding notes. The header carries days onboarding and, top-right, the account team as the shared compact initials cluster (`AccountTeamAvatars`; hover shows Role: Name). Its loader is `loadOnboardingDetail` (`app/my-dashboard/actions.ts`): a client on your account team, read from `v_client_onboarding`.
- **Row links and "All →"** appear only for pages the viewer may open (per the Roles matrix); otherwise a row falls back to the client's Client Detail, or is plain text if that isn't granted either.

It is **strictly personal**. Two people opening it at the same moment see different dashboards. There is no "see everything" mode, **not even for Super Users**: a Super User who isn't on any account team sees an empty book. To look at someone else's dashboard, use **View as {person}** (Admin → Users), which the page honours in full.

**Workflow cards (2026-10-08).** The single merged *My To-Do* focus card is gone. Every Alerts-style workflow is now **its own compact card** (approved mockup `my-dashboard-v5.html`), clustered in three columns under light group labels — **Feedback Tasks · Other Tasks and Activity · Administrative & Planning**.

**Close from the task card (2026-10-08).** The task drawer has a **Close** button next to Edit (owner or admin; confirm step) — see [14 — Tasks → Close from the card](14-tasks.md#close-from-the-card-2026-10-08). A closed task drops off Other Open Tasks and the counts on refresh; a Dynamics task closed here (sidecar `closed_at`, still Open in the mirror) is left out too.

**Records open in place.** Rows backed by a CRM **task** (Other Open Tasks, both Report cards) open the **task drawer** on the dashboard (`task-drawer.tsx` — the same `TaskRecordPane` + `EditTaskDialog` as CRM → Tasks). **Hosting** rows open the **meeting drawer** (`meeting-drawer.tsx` — the same `MeetingRecordPane` + `EditMeetingDialog` as CRM → Meetings). Edit / close out use the drawers' existing actions and guards: Edit is offered only for dashboard-origin records and refused server-side otherwise, so **Dynamics records open read-only until cutover**. After a save the dashboard refreshes. The task drawer is offered only to people who can open CRM → Tasks; the meeting drawer opens for everyone, scoped to meetings they host (see Per-feed permissions). All other rows are links; links only appear for pages *you* can open, otherwise falling back to the client's **Client Detail**.

Top to bottom:

1. **Top banner** (2026-10-08, mockup `my-dashboard-topbanner.html`) — ONE card holding, top to bottom, the greeting row, the KPI strip and My Book (they used to be separate strips). Layout only: no data or scoping changed.
   - **Greeting** with today's date. *(Removed 2026-10-17: the red "Needs you now" pill that sat on the right. `page.tsx` still loads the critical count, which is now unused by the view; the per-row and per-card critical flags carry the same rule.)* It used to read: a red **Needs you now** pill on the right, e.g. "**4 critical** · 1 to host today/tomorrow · 2 overdue". The headline is the **critical count — the same number as the red flags and the nav badge** (it is the badge's own function, `loadMyDashboardCriticalCount`, called by `page.tsx`); approvals are inside it, so they are not listed separately. Then meetings you host today/tomorrow. "N overdue" (your own items 1+ days past due) is a muted secondary figure only, never the headline. Shown only when something is critical or hosting is imminent (2026-10-08).
   - **Six KPI tiles** — the shared floating `StatCard` (white, subtle border and shadow, number over label), two / three / six per row by width, same red / amber rule. **Display-only since 2026-10-17** (no jump link). In order: **Items Requiring Attention** (the Home nav badge's own number — `loadMyDashboardCriticalCount`, every critical "!" row; was "Overdue Items") · **Feedback Collection** · **Feedback Reports** (Pending Review + In Process) · **Hosting (Next 7 Days)** · **Contracts Expiring (≤ 60 days)** · **Approvals**.
   - **My Book** — under a thin divider: active clients where you are **Primary, Secondary, Associate or Logistics** (`CORE_TEAM_ROLES` in `load.ts`), grouped by that role. Feedback and Memo assignments are left out of the strip and its count — the cards still use the full six-role book. Each ticker opens that client's Client Detail; **Open all in Portfolio →** goes to Portfolio. Role groups are tagged **PRI · SEC · ASSOC · LOG** (full role on hover) and separated by small dots, in that order, as **one continuous wrapping flow** — lines break wherever the width runs out (not at role boundaries), so a long book fills each line and continues on the next; "Open all in Portfolio →" ends the flow.
2. **Jump to** quick-link bar (2026-10-08; approved mockup `my-dashboard-quicklinks-v3.html`, variant D·) — directly below the top banner, a slim, full-width segmented bar of text links labelled **Jump to page**: **Portfolio** (`/portfolio`) · **Outreach Status** (`/clients/to-do`) · **Live Outreach** (`/live-outreach`) · **Feedback Reports** (`/feedback-manager`) · **Feedback Collection** (`/feedback-collection`) · **Onboarding** (`/onboarding`). It is **low-key but defined**: a light-gray bar (`#EEF1F5`, a shade off the page canvas `#F4F6F9`) with a light 1px border and rounded corners, thin dividers between segments, muted gray text at rest; a light blue tint and blue text appear only on hover. Equal segments; wraps to two or three per row on narrow screens. **Per-user:** a segment shows only if you can open that page — `JUMP_LINKS` filtered through the same `canAccessRoute` check as every other link here (`jumpLinks` in `load.ts`); the rest share the width evenly, and each page still enforces its own access server-side. **Client Health** (`/client-health`) was added after Outreach Status on 2026-10-11. Like every link in the bar, it shows only to viewers who may open it (`canAccessRoute`), which today means super users.
3. **The workflow cards** — no section heading above them (the "To-Dos & Activity" heading and its "What needs your action…" subtext were removed 2026-10-17; the flag legend moved to the top right of the banner). A fixed **two-column** grid (not masonry; was three columns until 2026-10-17):

   | Left column | Right column |
   |---|---|
   | **Things To Do** — Feedback Collection · Feedback Reports Pending Review · Feedback Reports In Process · Profiles to Review · Other Open Tasks · Hosting · Next 7 Days | **Administrative & More** — Time Off Approvals · Onboarding · Contracts Expiring · Active Marketing |

   Each category heading carries a one-line description of what it holds. Each card title is semibold (2026-10-17), with its own one-line description underneath.

   On narrower screens (below `lg`) the two columns stack into one: left column first, then right.

**Card behaviour.** Each card has a header with its title, a **count** and **All →** (to the matching full page/queue; hidden if you can't open it). It shows at most **5 rows**, with "+ N more · View all →" beneath when there are more — except **Contracts Expiring** (up to 8) and **Active Marketing**, which always lists every event. Meeting rows are labelled **ticker × firm** (e.g. "ABX × Fidelity") to save space. A clean one-line empty state when there's nothing.

**Colour.** No decorative colour: red = overdue and amber = due soon are the only colours. A card's **count** and its **KPI tile** use the same rule (`cardTone()` in the view): red if any row is overdue, otherwise amber if any is due soon, otherwise neutral. The Overdue tile is red whenever non-zero. Chips, tickers, progress bars and onboarding dots are neutral (onboarding uses filled vs hollow dots).

**Critical flag.** A bold filled red "!" circle at the left of a row, clearly bigger than the status dot, on:

- rows **severely overdue** — **7+ days past due** (`isCritical()` / `CRITICAL_OVERDUE_DAYS` in `policy.ts`) — on Feedback to Collect, both Report cards, Other Open Tasks and Profiles to Review (an escalation on top of the plain red overdue text);
- **every pending Time Off Approval** — it blocks the requester (2026-10-08). The card count and the Approvals KPI are red whenever any are waiting.

**Alert flags (2026-10-17).** Borrowed from the first My Dashboard (2026-10-07) and the retired Alerts page, same red / amber rule as above:

- **Left edge** — a 3px red edge on overdue rows and amber on due-soon rows (Feedback, Reports, Other Open Tasks, Profiles; Hosting today/tomorrow; Contracts by `contractTone`). Critical rows also get a faint red wash.
- *(Removed 2026-10-17: a "! N critical" total in card headers — redundant with the card's count and the per-row "!" flags.)*
- **Days-left pill** — on Contracts Expiring rows ("42d"): red ≤7, amber ≤30, otherwise a quiet IQ sand pill.
- **Legend** — one line at the top right of the banner (where the "Needs you now" pill was): Critical · Due soon (next 7 days) — "Overdue" was dropped from the legend 2026-10-17 (rows keep their red edge).

**Nav badge.** The My Dashboard item in the sidebar carries a red count badge (bubble on the collapsed rail, pill when labels show; "9+" above nine; hidden at 0) = the total number of critical-flagged rows for the current (effective) viewer. Counted by `loadMyDashboardCriticalCount()` (`app/my-dashboard/critical-count.ts`) in the root layout on every page — head-only SQL counts using the page's own resolvers, task filter and team rule, with the flag rule as date cutoffs (`criticalDueBefore` / `criticalMeetingBefore`, proven equal to `isCritical` in `policy.test.ts`). After an approve / deny the page refreshes, so the row drops off and the badge recounts. Fail-soft: an error counts 0. The Pending Review part counts only core-team clients, like the card.

**Typography, two tiers (2026-10-17).** The category headers (Things To Do · Administrative & More) use style A — an 11px uppercase overline (Action items — placeholder / Informational), a 20px bold title and a one-line description, no rule underneath; a 1px `#e6eaf0` vertical hairline separates the two columns at `lg+` (hidden when stacked) — no colour accents, bands, icon badges, count pills or tinted column panels (those experiments were removed 2026-10-17); card titles are black 14px semibold with their own one-line description.

**Styling:** built from the app's own components — the `ListTitleCard` masthead, floating `StatCard` KPIs, `CARD_CLASS` surfaces — so fonts and surfaces match the rest of the app.

---

## Who counts as "me" and "my clients"

| Term | Rule | Code |
|---|---|---|
| **Me** | Your sign-in email resolved to your Dynamics user id(s) — duplicate CRM records are unioned. If your email can't be matched, every "me" feed is **denied** (a yellow notice says so) rather than shown as "nothing outstanding". | `viewerUserIds()` in `app/clients/alerts/load.ts` |
| **My clients** | Accounts where you hold **any of the six** team roles: Account Manager (Primary), Secondary, Feedback Report, Associate, Memo, Logistics. | `resolveAccountTeamScope()` in `lib/access/account-team-scope.ts` |
| **My Book** | My clients that are **Active** (`accounts.state_label = 'Active'`). All cards except the feedback cards use the book. | `app/my-dashboard/load.ts` |
| **Account manager** | The **Primary** role = `accounts.sales_lead_primary_id`. | `TEAM_ROLES` in `lib/access/account-team-policy.ts` |

**Source of truth for the team.** Team membership is read from the live account lookups on `public.accounts`. For **dashboard-created** clients those lookups are written from `account_team_members` by a database trigger, so the dashboard-owned team *is* the source there; for **Dynamics** clients the CRM lookups are authoritative until cutover (see [17 — Account Teams](17-account-teams.md)). This is the same resolver the Alerts page and its nav badge use, so the three never disagree.

**Security.** The app reads with the service-role key (RLS does not apply), so `loadMyDashboard()` is the only gate on what's returned. Every query is filtered server-side to *your* ids or *your* account ids before it runs; a denied scope skips the query entirely instead of running it unfiltered.

---

## The cards — source, scope, link

**Due-date rule** (`dueTone()` in `app/my-dashboard/policy.ts`): before today → **red**; today through today + 7 days → **amber**; later or no date → neutral.

### Feedback Tasks

**Why it is on your card (2026-10-08).** Each feedback row's secondary line ends with the **inclusion reason**, worded exactly as on the Alerts page because it comes from the same logic: **Reports · Pending Review** and **Reports · Open / Claimed** — `teamLabel()` (exported from `app/clients/alerts/load.ts`), e.g. "You: Secondary" (Pending Review falls back to "Acct mgr: …" like Alerts); **Feedback to Collect** — "Owner: {name}" (the view's feedback owner, host fallback). Pending Review's detail is "Reviewer: …" or "Unclaimed" (Alerts' wording). Muted, truncated, full text on hover; rows with no reason simply omit it.

| Card | Source | Scope | Date / colour | Row opens | All → |
|---|---|---|---|---|---|
| **Feedback to Collect** | `v_feedback_outstanding` | `host_id` ∈ me (in this view `host_id` is the feedback-responsible collector, falling back to the host) | due = **meeting day + 10** (the firm's 10-day rule) | **meeting drawer** (2026-10-10) | `/feedback-collection` |
| **Feedback Reports Pending Review** (was Reports · Pending Review) | `v_feedback_pipeline`, `category = 'pending_review'` (Feedback closed, paired *Feedback Report Sent* task still open) | client where I hold a **CORE** team role — **Primary, Secondary, Associate or Logistics** (`coreTeamAccountIds()` / `CORE_TEAM_ROLES`); Feedback Report and Memo roles do **not** qualify (2026-10-08). Active and inactive clients, as before | report `due_date` | **event drawer on Meetings & Reports, focused on the report** (2026-10-17 — the Feedback Reports page's row deep link, via `loadEventRecord`) when the viewer has the CRM Events page; otherwise the task drawer on the paired open **Feedback Report Sent** task — the view's `review_task_id` (patch `2026-10-08_feedback_pipeline_review_task_id.sql`), for Dynamics and dashboard pairs alike; falls back to the Feedback task only until that patch is run | `/feedback-manager` |
| **Feedback Reports In Process** (was Reports · Open / Claimed) | `v_feedback_pipeline`, `category = 'in_progress'` | `claimed_by_id` ∈ me | report `due_date` | **event drawer on Meetings & Reports, focused on the report** (2026-10-17) when the viewer has the CRM Events page; otherwise the task drawer (the claimed report task) | `/feedback-manager` |

**"Claimed by me"** uses the pipeline view's `claimed_by_id` (`tasks.bcs_claimed_by_id`). A **Claim** on Feedback Reports keeps that field in step with the dashboard-owned claim (`tasks.claimed_by_id`), so a task you claim there appears here, and **Close** (task → Completed) drops it off. If the claim column is missing on a database, the card shows **empty, not an error**. See [14 — Tasks → Feedback claiming](14-tasks.md#feedback-claiming-feedback-reports--claim--release--reassign--close).

### Other Tasks and Activity

| Card | Source | Scope | Date / colour | Row opens | All → |
|---|---|---|---|---|---|
| **Other Open Tasks** | `v_admin_tasks_all`, `state_label = 'Open'`, **excluding feedback-type tasks** | **Mine** = `owner_id` ∈ me; **Team** = a book client's task owned by someone on **that client's** team (shows assignee + role) | task due date; dot + date red/amber | task drawer | `/tasks` |
| **Hosting · Next 7 Days** | `meetings` — Confirmed, Active, today … +7 days | `host_id` ∈ me | amber for today/tomorrow only | meeting drawer | `/meetings` |
| **Profiles to Review** | `v_profiles_upcoming`, `profile_label = 'Created/Under Review'` | clients where I'm **account manager** (Primary) | one row per client, dated by its earliest upcoming meeting (date only) | `/profiles` | `/profiles` |
| **Onboarding** | `v_client_onboarding` | book clients | nine checklist steps as filled/hollow dots, "n of 9 steps", day N | **onboarding card** (2026-10-10) | `/onboarding` |

**Feedback-task exclusion.** Other Open Tasks drops every task whose subtype is `Feedback` or `Feedback Report Sent` (`FEEDBACK_SUBTYPES` in `load.ts`) — those are exactly the tasks the Feedback cards are built from (including the automation's *Feedback Report Pending Review* tasks, which carry the *Feedback Report Sent* subtype). Tasks with no subtype are kept. So no task appears both in Other Open Tasks and a Feedback card. Rows are sorted **overdue first** (oldest due first, dateless last), with a **Mine** / **Team** chip.

### Administrative & More (was Administrative & Planning)

| Card | Source | Scope | Shows | Row opens | All → |
|---|---|---|---|---|---|
| **Active Marketing** | `v_live_outreach` (the view applies Live Outreach inclusion: `event_state_label = 'Live Outreach'`, Active, **Mining exclusion**) | book clients | booked (`confirmed_meeting_count`) vs required (`of_slots`) bar, open slots, event dates — **full list, no 5-row cap** | **event drawer** for the row's own Live Outreach event (2026-10-10) | `/live-outreach` |
| **Contracts Expiring** | `v_admin_contracts_all` — **both origins**, read-only; terminated and test rows excluded; **no money column read** | book clients | contracts whose **term end (expiration date) is within the next 60 days** (was 90 until 2026-10-17) (`contractDaysToExpiry()`), soonest first, **up to 8 rows** then "+ N more · View all →". Each row reads **"Expires Dec 1, 2026"** — red within 7 days, amber within 30 (`contractTone()`); the sub-line labels the notice date ("Notice by …", only while still ahead) and auto-renew. Same count as the Contracts ≤60d KPI. | *Rows display-only since 2026-10-17 (no link, no hover); was `/admin/contracts?client=…` (super users), else `/contract-management`* | same |
| **Time Off Approvals** | `time_off_requests` — `status = 'Pending'`, `origin = 'dashboard'` | requesters whose reviewing team includes me (`personIdsReviewedBy()`) | dates, days, type; **always critical** (red flag) | **opens the approve / deny drawer in place** | `/time-off-requests`, else `/time-off` |

---

## Performance

Two round-trip stages. **Stage 1** (parallel): your identity, your team scope, your role, and one bulk read of `accounts` (~230 rows), which yields every team member's id and name without per-row lookups. **Stage 2**: all 11 feed queries in **one** `Promise.all`, each filtered to your ids or your book and capped at 60 rows (plus one small follow-up to find the review task linked to each pending-review report). Each card fails soft — a broken source shows an error strip in that card only.

## Files

| File | What |
|---|---|
| `app/my-dashboard/page.tsx` | Route + gating note |
| `app/my-dashboard/load.ts` | The loader — all scoping and queries; one feed per card; `FEEDBACK_SUBTYPES` |
| `app/my-dashboard/policy.ts` (+ `policy.test.ts`) | Pure rules: due colours, contract window, feedback due day |
| `app/my-dashboard/my-dashboard-view.tsx` | The layout (server component): KPI strip, group labels, the ten cards |
| `app/my-dashboard/task-drawer.tsx` | Task drawer host (Reports + Other Open Tasks rows) |
| `app/my-dashboard/meeting-drawer.tsx` | Meeting drawer host (Hosting + Feedback to Collect rows) |
| `app/my-dashboard/event-drawer.tsx` | Event drawer host (Active Marketing rows) |
| `app/my-dashboard/onboarding-drawer.tsx` + `actions.ts` | Onboarding card (Onboarding rows) + its scoped loader |
| `app/my-dashboard/time-off-drawer.tsx` | Time-off drawer host (Approve / Deny) for Time Off Approvals rows |
| `app/my-dashboard/critical-count.ts` | The nav badge count (critical rows), run by `app/layout.tsx` |
| `lib/access-control.ts` | `/my-dashboard` in `ALWAYS_ALLOWED_ROUTES` (every signed-in user with a role) |
| `components/nav.tsx` | "My Dashboard" — first item in the rail |

No SQL — every card reads an existing view or table.
