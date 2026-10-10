# 26 — My Dashboard

## What it does (plain language)

**My Dashboard** (`/my-dashboard`) is the personal home page: one screen with everything on *your* plate across the clients you're on the account team for. It's the first item in the sidebar and where you land after signing in.

**Open to every signed-in user** (2026-10-08; was super-user only from 2026-10-07). `/my-dashboard` is in `ALWAYS_ALLOWED_ROUTES` (`lib/access-control.ts`), so it shows in everyone's nav and needs no Roles-matrix grant (it's no longer listed in the matrix). An account with **no role yet** is still sent to `/no-access` (the page checks). **Default homepage (2026-10-08):** every user with a role lands on My Dashboard after signing in, from `/login` when already signed in, **and at the app root `/`** (`app/page.tsx` → `homeRouteFor()`: My Dashboard, else Portfolio, else the first page the role can open, else `/no-access`; Client Statistics stays at `/client-statistics`); a role-less user goes the old Portfolio → `/no-access` way (`landingRouteFor`, used by the auth callback, `/login` and `proxy.ts`). **To make it super-user only again:** move the route to `ADMIN_ONLY_ROUTES` — nav and landing follow automatically.

**Per-feed permissions.** No feed depends on the viewer's role: every query runs server-side with the service-role key and is filtered to the viewer's own ids or account teams (table below), so a normal user's dashboard is fully populated without any extra grant, and never shows anyone else's items. Role only affects **where a row goes when clicked**:

- **Task drawer** is offered only to viewers who can open CRM → Tasks (super users today — `loadTaskRecord` is super-user only and CRM → Tasks is unscoped); everyone else clicks through to the row's link. **Meeting drawer** (Hosting rows) opens for **every** viewer through `loadHostedMeetingRecord` (`app/meetings/actions.ts`), which returns a meeting only if the viewer **hosts** it — the Hosting card's own scope — and refuses anything else; its Edit button stays super-user only.
- **Time-off drawer** (Time Off Approvals rows) opens for **every** viewer through `loadTimeOffApprovalRecord` (`app/time-off-requests/actions.ts`) — only for a request whose requester you review — and is the same drawer as CRM → Time Off, with **Approve / Deny** (`ReviewControls` → `reviewTimeOffRequest`). **Inline Approve / Deny (2026-10-08):** each row also carries **Approve** (one click + an inline **Confirm**) and **Deny** (never instant — opens an inline prompt that **requires a reason**, saved as the review comment). Both are optimistic (row disappears at once; restored with an error toast if refused), call the same `reviewTimeOffRequest`, and on success refresh the page so the card, the "critical" pill and the nav badge recount. Buttons are hidden in "View as"; the server enforces who may act (reviewing team, not the requester, not in View as) and refuses anyone else with "Not authorised". Clicking the row itself still opens the full drawer (`TimeOffApprovalRow` in `time-off-drawer.tsx`).
- **Row links and "All →"** appear only for pages the viewer may open (per the Roles matrix); otherwise a row falls back to the client's Client Detail, or is plain text if that isn't granted either.

It is **strictly personal**. Two people opening it at the same moment see different dashboards. There is no "see everything" mode, **not even for Super Users**: a Super User who isn't on any account team sees an empty book. To look at someone else's dashboard, use **View as {person}** (Admin → Users), which the page honours in full.

**Workflow cards (2026-10-08).** The single merged *My To-Do* focus card is gone. Every Alerts-style workflow is now **its own compact card** (approved mockup `my-dashboard-v5.html`), clustered in three columns under light group labels — **Feedback Tasks · Other Tasks and Activity · Administrative**.

**Close from the task card (2026-10-08).** The task drawer has a **Close** button next to Edit (owner or admin; confirm step) — see [14 — Tasks → Close from the card](14-tasks.md#close-from-the-card-2026-10-08). A closed task drops off Other Open Tasks and the counts on refresh; a Dynamics task closed here (sidecar `closed_at`, still Open in the mirror) is left out too.

**Records open in place.** Rows backed by a CRM **task** (Other Open Tasks, both Report cards) open the **task drawer** on the dashboard (`task-drawer.tsx` — the same `TaskRecordPane` + `EditTaskDialog` as CRM → Tasks). **Hosting** rows open the **meeting drawer** (`meeting-drawer.tsx` — the same `MeetingRecordPane` + `EditMeetingDialog` as CRM → Meetings). Edit / close out use the drawers' existing actions and guards: Edit is offered only for dashboard-origin records and refused server-side otherwise, so **Dynamics records open read-only until cutover**. After a save the dashboard refreshes. The task drawer is offered only to people who can open CRM → Tasks; the meeting drawer opens for everyone, scoped to meetings they host (see Per-feed permissions). All other rows are links; links only appear for pages *you* can open, otherwise falling back to the client's **Client Detail**.

Top to bottom:

1. **Top banner** (2026-10-08, mockup `my-dashboard-topbanner.html`) — ONE card holding, top to bottom, the greeting row, the KPI strip and My Book (they used to be separate strips). Layout only: no data or scoping changed.
   - **Greeting** with today's date, and a red **Needs you now** pill on the right, e.g. "**4 critical** · 1 to host today/tomorrow · 2 overdue". The headline is the **critical count — the same number as the red flags and the nav badge** (it is the badge's own function, `loadMyDashboardCriticalCount`, called by `page.tsx`); approvals are inside it, so they are not listed separately. Then meetings you host today/tomorrow. "N overdue" (your own items 1+ days past due) is a muted secondary figure only, never the headline. Shown only when something is critical or hosting is imminent (2026-10-08).
   - **Six KPI tiles** — the shared floating `StatCard` (white, subtle border and shadow, number over label — the original look, kept after a brief condensed trial), two / three / six per row by width. Same six KPIs, values and red / amber rule — Overdue · To collect · Pending review · Host · 7d · Contracts ≤90d · Approvals. Clicking a tile jumps to its card.
   - **My Book** — under a thin divider: active clients where you are **Primary, Secondary, Associate or Logistics** (`CORE_TEAM_ROLES` in `load.ts`), grouped by that role. Feedback and Memo assignments are left out of the strip and its count — the cards still use the full six-role book. Each ticker opens that client's Client Detail; **Open all in Portfolio →** goes to Portfolio. Role groups are tagged **PRI · SEC · ASSOC · LOG** (full role on hover) and separated by small dots, in that order, as **one continuous wrapping flow** — lines break wherever the width runs out (not at role boundaries), so a long book fills each line and continues on the next; "Open all in Portfolio →" ends the flow.
2. **Jump to** quick-link bar (2026-10-08; approved mockup `my-dashboard-quicklinks-v3.html`, variant D·) — directly below the top banner, a slim, full-width segmented bar of text links labelled **Jump to page**: **Portfolio** (`/portfolio`) · **Outreach Status** (`/clients/to-do`) · **Live Outreach** (`/live-outreach`) · **Feedback Reports** (`/feedback-manager`) · **Feedback Collection** (`/feedback-collection`) · **Onboarding** (`/onboarding`). It is **low-key but defined**: a light-gray bar (`#EEF1F5`, a shade off the page canvas `#F4F6F9`) with a light 1px border and rounded corners, thin dividers between segments, muted gray text at rest; a light blue tint and blue text appear only on hover. Equal segments; wraps to two or three per row on narrow screens. **Per-user:** a segment shows only if you can open that page — `JUMP_LINKS` filtered through the same `canAccessRoute` check as every other link here (`jumpLinks` in `load.ts`); the rest share the width evenly, and each page still enforces its own access server-side.
3. **"My To-Dos & Activity"** — a section heading (with a one-line subtext) over **the workflow cards**: a fixed three-column grid (not masonry), one cluster per column:

   | Feedback Tasks | Other Tasks and Activity | Administrative |
   |---|---|---|
   | Feedback to Collect | Other Open Tasks | Time Off Approvals |
   | Reports · Pending Review | Hosting · Next 7 Days | Active Marketing |
   | Reports · Open / Claimed | Profiles to Review | Contracts Expiring |
   | | Onboarding | |

   On narrower screens (below `lg`) the three columns stack into one, in the same order.

**Card behaviour.** Each card has a header with its title, a **count** and **All →** (to the matching full page/queue; hidden if you can't open it). It shows at most **5 rows**, with "+ N more · View all →" beneath when there are more — except **Contracts Expiring** (up to 8) and **Active Marketing**, which always lists every event. Meeting rows are labelled **ticker × firm** (e.g. "ABX × Fidelity") to save space. A clean one-line empty state when there's nothing.

**Colour.** No decorative colour: red = overdue and amber = due soon are the only colours. A card's **count** and its **KPI tile** use the same rule (`cardTone()` in the view): red if any row is overdue, otherwise amber if any is due soon, otherwise neutral. The Overdue tile is red whenever non-zero. Chips, tickers, progress bars and onboarding dots are neutral (onboarding uses filled vs hollow dots).

**Critical flag.** A bold filled red "!" circle at the left of a row, clearly bigger than the status dot, on:

- rows **severely overdue** — **7+ days past due** (`isCritical()` / `CRITICAL_OVERDUE_DAYS` in `policy.ts`) — on Feedback to Collect, both Report cards, Other Open Tasks and Profiles to Review (an escalation on top of the plain red overdue text);
- **every pending Time Off Approval** — it blocks the requester (2026-10-08). The card count and the Approvals KPI are red whenever any are waiting.

**Nav badge.** The My Dashboard item in the sidebar carries a red count badge (bubble on the collapsed rail, pill when labels show; "9+" above nine; hidden at 0) = the total number of critical-flagged rows for the current (effective) viewer. Counted by `loadMyDashboardCriticalCount()` (`app/my-dashboard/critical-count.ts`) in the root layout on every page — head-only SQL counts using the page's own resolvers, task filter and team rule, with the flag rule as date cutoffs (`criticalDueBefore` / `criticalMeetingBefore`, proven equal to `isCritical` in `policy.test.ts`). After an approve / deny the page refreshes, so the row drops off and the badge recounts. Fail-soft: an error counts 0. The Pending Review part counts only core-team clients, like the card.

**Typography, three tiers.** "My To-Dos & Activity" is the largest heading (20px bold); the column headers (Feedback Tasks · Other Tasks and Activity · Administrative) are black 16px bold with a thin rule; card titles are black 14px bold.

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
| **Feedback to Collect** | `v_feedback_outstanding` | `host_id` ∈ me (in this view `host_id` is the feedback-responsible collector, falling back to the host) | due = **meeting day + 10** (the firm's 10-day rule) | `/feedback-collection?client=…` | `/feedback-collection` |
| **Reports · Pending Review** | `v_feedback_pipeline`, `category = 'pending_review'` (Feedback closed, paired *Feedback Report Sent* task still open) | client where I hold a **CORE** team role — **Primary, Secondary, Associate or Logistics** (`coreTeamAccountIds()` / `CORE_TEAM_ROLES`); Feedback Report and Memo roles do **not** qualify (2026-10-08). Active and inactive clients, as before | report `due_date` | task drawer on the paired open **Feedback Report Sent** task — the view's `review_task_id` (patch `2026-10-08_feedback_pipeline_review_task_id.sql`), for Dynamics and dashboard pairs alike; falls back to the Feedback task only until that patch is run | `/feedback-manager` |
| **Reports · Open / Claimed** | `v_feedback_pipeline`, `category = 'in_progress'` | `claimed_by_id` ∈ me | report `due_date` | task drawer (the claimed report task) | `/feedback-manager` |

**"Claimed by me"** uses the pipeline view's `claimed_by_id` (`tasks.bcs_claimed_by_id`). A **Claim** on Feedback Reports keeps that field in step with the dashboard-owned claim (`tasks.claimed_by_id`), so a task you claim there appears here, and **Close** (task → Completed) drops it off. If the claim column is missing on a database, the card shows **empty, not an error**. See [14 — Tasks → Feedback claiming](14-tasks.md#feedback-claiming-feedback-reports--claim--release--reassign--close).

### Other Tasks and Activity

| Card | Source | Scope | Date / colour | Row opens | All → |
|---|---|---|---|---|---|
| **Other Open Tasks** | `v_admin_tasks_all`, `state_label = 'Open'`, **excluding feedback-type tasks** | **Mine** = `owner_id` ∈ me; **Team** = a book client's task owned by someone on **that client's** team (shows assignee + role) | task due date; dot + date red/amber | task drawer | `/tasks` |
| **Hosting · Next 7 Days** | `meetings` — Confirmed, Active, today … +7 days | `host_id` ∈ me | amber for today/tomorrow only | meeting drawer | `/meetings` |
| **Profiles to Review** | `v_profiles_upcoming`, `profile_label = 'Created/Under Review'` | clients where I'm **account manager** (Primary) | one row per client, dated by its earliest upcoming meeting (date only) | `/profiles` | `/profiles` |
| **Onboarding** | `v_client_onboarding` | book clients | nine checklist steps as filled/hollow dots, "n of 9 steps", day N | `/onboarding` | `/onboarding` |

**Feedback-task exclusion.** Other Open Tasks drops every task whose subtype is `Feedback` or `Feedback Report Sent` (`FEEDBACK_SUBTYPES` in `load.ts`) — those are exactly the tasks the Feedback cards are built from (including the automation's *Feedback Report Pending Review* tasks, which carry the *Feedback Report Sent* subtype). Tasks with no subtype are kept. So no task appears both in Other Open Tasks and a Feedback card. Rows are sorted **overdue first** (oldest due first, dateless last), with a **Mine** / **Team** chip.

### Administrative

| Card | Source | Scope | Shows | Row opens | All → |
|---|---|---|---|---|---|
| **Active Marketing** | `v_live_outreach` (the view applies Live Outreach inclusion: `event_state_label = 'Live Outreach'`, Active, **Mining exclusion**) | book clients | booked (`confirmed_meeting_count`) vs required (`of_slots`) bar, open slots, event dates — **full list, no 5-row cap** | `/live-outreach#event-<id>` | `/live-outreach` |
| **Contracts Expiring** | `v_admin_contracts_all` — **both origins**, read-only; terminated and test rows excluded; **no money column read** | book clients | contracts whose **term end (expiration date) is within the next 90 days** (`contractDaysToExpiry()`), soonest first, **up to 8 rows** then "+ N more · View all →". Each row reads **"Expires Dec 1, 2026"** — red within 7 days, amber within 30 (`contractTone()`); the sub-line labels the notice date ("Notice by …", only while still ahead) and auto-renew. Same count as the Contracts ≤90d KPI. | `/admin/contracts?client=…` (super users), else `/contract-management` | same |
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
| `app/my-dashboard/meeting-drawer.tsx` | Meeting drawer host (Hosting rows) |
| `app/my-dashboard/time-off-drawer.tsx` | Time-off drawer host (Approve / Deny) for Time Off Approvals rows |
| `app/my-dashboard/critical-count.ts` | The nav badge count (critical rows), run by `app/layout.tsx` |
| `lib/access-control.ts` | `/my-dashboard` in `ALWAYS_ALLOWED_ROUTES` (every signed-in user with a role) |
| `components/nav.tsx` | "My Dashboard" — first item in the rail |

No SQL — every card reads an existing view or table.
