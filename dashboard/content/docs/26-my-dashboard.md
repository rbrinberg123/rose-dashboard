# 26 — My Dashboard

## What it does (plain language)

**My Dashboard** (`/my-dashboard`) is the personal home page: one screen with everything on *your* plate across the clients you're on the account team for. It's the first item in the sidebar and where you land after signing in.

**Super users only, for now** (2026-10-07): `/my-dashboard` is in `ADMIN_ONLY_ROUTES` — the same one-flag gate as FB Coming Soon — so it's hidden from the nav and blocked server-side for everyone else. **Landing:** super users land on My Dashboard after signing in; everyone else lands on **Portfolio**, the app's original default (`landingRouteFor` in `lib/access-control.ts`, used by the auth callback, `/login` and `proxy.ts`). **To open it to everyone:** move the route back to `ALWAYS_ALLOWED_ROUTES` — landing follows automatically.

It is **strictly personal**. Two people opening it at the same moment see different dashboards. There is no "see everything" mode, **not even for Super Users**: a Super User who isn't on any account team sees an empty book. To look at someone else's dashboard, use **View as {person}** (Admin → Users), which the page honours in full.

**Task items open in place (2026-10-07).** Items backed by a CRM **task** — every **Open Tasks** row (Mine and Team), and the My To-Do **Report** (your claimed feedback report) and **Review** items (the linked *Feedback Report Pending Review* task when the automation created one, otherwise the report task) — open the **CRM task drawer right on the dashboard** (`app/my-dashboard/task-drawer.tsx`, the same `TaskRecordPane` + `EditTaskDialog` as CRM → Tasks). Edit / close out (Edit → Status *Completed*) use the drawer's existing actions and the existing guard: Edit is offered only for dashboard-origin tasks and refused server-side otherwise, so **Dynamics tasks open read-only until cutover**. After a save the dashboard refreshes, so a completed task drops off. The drawer is offered only to people who can open CRM → Tasks (`loadTaskRecord` is super-user only — not loosened); everyone else keeps the normal link. Collect (a meeting), Host (a meeting), Profiles and Approve (a time-off request) items keep their existing links.

Otherwise the page is read-only. Every line links to the underlying record (or the closest page that shows it) with a small **open ↗**; links only appear for pages *you* are allowed to open, and otherwise fall back to the client's **Client Detail** page.

Top to bottom:

1. **Greeting** with today's date, and a red **Needs you now** pill on the right — shown only when something is urgent (overdue items, a meeting you host today/tomorrow, time-off approvals waiting on you).
2. **My Book** strip — every active client you're on the team for, grouped by your role (Primary · Secondary · Feedback · Associate · Memo · Logistics). Each ticker opens that client's Client Detail; **Open all in Portfolio →** goes to Portfolio.
3. **Five KPI tiles** (the shared floating `StatCard`, inside the page masthead) — Overdue · My To-Do · Open Tasks · Contracts ≤90d · Host · Next 7d. Only Overdue takes a colour (red, when non-zero); clicking a tile jumps to its card.
4. **The card grid** — a fixed three-column layout (not masonry), so cards never move around:
   - **Left:** My To-Do (the highlighted focus card)
   - **Middle:** Open Tasks, then Contracts Expiring Soon
   - **Right:** Onboarding (always at the top), Active Marketing, Time Off Approvals

   **Styling:** built from the app's own components — the `ListTitleCard` masthead, floating `StatCard` KPIs, `CARD_CLASS` surfaces and the Alerts type scale (14 / 12.5 / 11.5) — so fonts and surfaces match the rest of the app. No decorative colour: red = overdue and amber = due soon are the only colours; chips, tickers, progress bars and onboarding dots are neutral (onboarding uses filled vs hollow dots).

   On a medium-width screen it becomes two columns with the right-hand cards in a row beneath; on a phone, one column.

---

## Who counts as "me" and "my clients"

| Term | Rule | Code |
|---|---|---|
| **Me** | Your sign-in email resolved to your Dynamics user id(s) — duplicate CRM records are unioned. If your email can't be matched, every "me" feed is **denied** (a yellow notice says so) rather than shown as "nothing outstanding". | `viewerUserIds()` in `app/clients/alerts/load.ts` |
| **My clients** | Accounts where you hold **any of the six** team roles: Account Manager (Primary), Secondary, Feedback Report, Associate, Memo, Logistics. | `resolveAccountTeamScope()` in `lib/access/account-team-scope.ts` |
| **My Book** | My clients that are **Active** (`accounts.state_label = 'Active'`). All cards except the feedback to-dos use the book. | `app/my-dashboard/load.ts` |
| **Account manager** | The **Primary** role = `accounts.sales_lead_primary_id`. | `TEAM_ROLES` in `lib/access/account-team-policy.ts` |

**Source of truth for the team.** Team membership is read from the live account lookups on `public.accounts`. For **dashboard-created** clients those lookups are written from `account_team_members` by a database trigger, so the dashboard-owned team *is* the source there; for **Dynamics** clients the CRM lookups are authoritative until cutover (see [17 — Account Teams](17-account-teams.md)). This is the same resolver the Alerts page and its nav badge use, so the three never disagree.

**Security.** The app reads with the service-role key (RLS does not apply), so `loadMyDashboard()` is the only gate on what's returned. Every query is filtered server-side to *your* ids or *your* account ids before it runs; a denied scope skips the query entirely instead of running it unfiltered. The route is in `ALWAYS_ALLOWED_ROUTES` (`lib/access-control.ts`) — that is safe only because of this row scoping.

---

## The feeds

### My To-Do

Only things **you personally** are on the hook for. Each item has a type chip and a coloured left edge for its urgency bucket.

**Urgency rule** (`urgencyFor()` in `app/my-dashboard/policy.ts`) — an item sorts by **its own date**:

- before today → **Overdue** (red)
- today through today + 7 days → **This week** (amber)
- later than that, or no date → **Later / no date** (grey)

So a dated item (a PTO request for next week, a meeting you host) floats up into *This week* as it approaches; only genuinely dateless items stay in *Later*.

| Item | Chip | Source | Scope | Date used | Links to |
|---|---|---|---|---|---|
| Feedback to collect | Collect | `v_feedback_outstanding` | `host_id` ∈ me (in this view `host_id` is the feedback-responsible person, falling back to the host) | **Meeting day + 10** — the firm's 10-day rule. It's already due, so it is never in *Later*: within 10 days → This week, after → Overdue | `/feedback-collection?client=…` |
| Feedback report pending review | Review | `v_feedback_pipeline`, `category = 'pending_review'` | client ∈ **all** my team accounts (same as Alerts) | report `due_date` | `/feedback-manager` |
| Open report I've claimed | Report | `v_feedback_pipeline`, `category = 'in_progress'` | `claimed_by_id` ∈ me | report `due_date` | `/feedback-manager` |
| Profiles to review | Profiles | `v_profiles_upcoming`, `profile_label = 'Created/Under Review'` | clients where I'm **account manager** | earliest upcoming meeting for that client (one line per client, with a count) | `/profiles` |
| Host a meeting (next 7 days) | Host | `meetings` — Confirmed, Active, today .. +7 days | `host_id` ∈ me | meeting day | `/meetings?client=…` (super users) |
| Approve time off | Approve | `time_off_requests` — `status = 'Pending'`, `origin = 'dashboard'` | requesters whose reviewing team includes me (`personIdsReviewedBy()`, `time_off_reviewers`) | request start date | `/time-off-requests`, else `/time-off` |

**"Claimed by me"** uses the pipeline view's `claimed_by_id` (`tasks.bcs_claimed_by_id`). A **Claim** on Feedback Reports keeps that field in step with the dashboard-owned claim (`tasks.claimed_by_id`), so a task you claim there appears here, and **Close** (task → Completed) drops it off. See [14 — Tasks → Feedback claiming](14-tasks.md#feedback-claiming-feedback-reports--claim--release--reassign--close).

### Open Tasks

`v_admin_tasks_all`, `state_label = 'Open'`, in two clearly different groups:

- **Mine** (navy chip + navy edge) — `owner_id` ∈ me.
- **Team** (grey chip) — tasks on a **book** client owned by someone else on **that client's** team; shows the assignee and their role(s) on that client.

Due dates are red when past and amber within 7 days. Links go to `/tasks?client=…` for super users (the Tasks page is super-user only), otherwise to Client Detail.

**Removed (2026-10-07) — Clients at Risk.** An earlier version listed book clients rated 2 / 3 / Management-IR from `client_health_assessments`. The card, its KPI tile and the query were taken out by request; this page no longer reads Client Health at all.

### Active Marketing

`v_live_outreach` for book clients. The view itself applies the Live Outreach inclusion rules — `event_state_label = 'Live Outreach'`, Active, and the **Mining exclusion** — so nothing is re-filtered here. Shows confirmed meetings (`confirmed_meeting_count`) vs required (`of_slots`) as a bar, plus open slots (`slots_remaining`) and the event dates. Links to `/live-outreach#event-<id>`.

### Contracts Expiring Soon

`v_admin_contracts_all` (both Dynamics and dashboard origins) for book clients, excluding terminated (`termination_date` set) and test rows. Listed when the **notice date** — or, once that has passed, the **term end** — falls within the next **90 days** (`contractKeyDay()`). The badge is days left (amber ≤ 30, otherwise neutral). **No money column is read.** Links: `/admin/contracts?client=…` for super users, otherwise `/contract-management`, otherwise Client Detail.

### Onboarding

`v_client_onboarding` for book clients (the view already limits to clients currently onboarding). One block per client with the nine checklist steps as dots — filled = done, hollow = not yet — and an "n/9 done · day N" summary. Links to `/onboarding`.

### Time Off Approvals

**Approvals only** — the time-off requests waiting on *my* approval/review: requester, dates, request type and day count. Source and scope are exactly the My To-Do "Approve" item (one query feeds both): `time_off_requests` with `status = 'Pending'`, `origin = 'dashboard'`, from requesters whose reviewing team includes me (`personIdsReviewedBy()`). The date is amber when the request starts within 7 days and red if it has already started. There is no per-request deep link, so each row opens `/time-off-requests` (super users) or `/time-off`. Empty state: "No time-off requests are waiting on your approval."

(An earlier version showed who on my account teams was out; that was removed 2026-10-07 by request.)

---

## Performance

Two round-trip stages. **Stage 1** (parallel): your identity, your team scope, your role, and one bulk read of `accounts` (~230 rows), which yields every team member's id and name without per-row lookups. **Stage 2**: all 11 feed queries in **one** `Promise.all`, each filtered to your ids or your book and capped at 60 rows. Each card fails soft — a broken source shows an error strip in that card only.

## Files

| File | What |
|---|---|
| `app/my-dashboard/page.tsx` | Route + gating note |
| `app/my-dashboard/load.ts` | The loader — all scoping and queries |
| `app/my-dashboard/policy.ts` (+ `policy.test.ts`) | Pure rules: urgency buckets, contract window, feedback due day |
| `app/my-dashboard/my-dashboard-view.tsx` | The layout (server component) |
| `lib/access-control.ts` | `/my-dashboard` in `ALWAYS_ALLOWED_ROUTES` |
| `components/nav.tsx` | "My Dashboard" — first item in the rail |
| `lib/auth-callback.ts`, `app/login/page.tsx`, `proxy.ts` | Post-sign-in landing is now `/my-dashboard` (was `/portfolio`) |

No SQL — every feed reads an existing view or table.
