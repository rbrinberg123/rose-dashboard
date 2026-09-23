# Dashboard Documentation

Welcome. This is the living documentation for the Rose & Company management dashboard. It is written for a **layered audience**: every page starts with plain-language "what it does / how to use it," then a **Technical** section with the exact files, views, and gotchas.

These files live in `dashboard/content/docs/` and are also browsable in-app at **Admin → Docs** (super-user only), where they sit alongside always-live reference panels generated from the running system.

> **How to keep this accurate:** every statement here is grounded in the actual code, with the source file cited for non-obvious rules. When you change the code, update the matching doc. The in-app **live panels** (views, tables, schedules, sync status, env inventory) are generated from the real system at page load, so they never go stale — use them as the source of truth for "what exists right now," and use these prose docs for "what it means and why."

## Contents

| Doc | What's inside |
|-----|---------------|
| [00 — Architecture](00-architecture.md) | What the app is, the stack, and the Dynamics → sync → tables → views → pages data flow. Start here. |
| [01 — Access & Users](01-access-and-users.md) | The two roles, how access is enforced, magic-link login, and how to open a page to plain users. |
| [02 — Pages](02-pages.md) | Every page/route: what it's for, who can see it, and which view it reads. |
| [03 — Data Model](03-data-model.md) | The mirror tables, their Dynamics entities, the `_raw` pattern, and the ops tables. |
| [04 — Views](04-views.md) | A catalog of all 58 computed `v_*` views — the biggest doc. |
| [05 — Sync & Integrations](05-sync-and-integrations.md) | How the nightly Dynamics sync works, and the two Azure apps. |
| [06 — Automations](06-automations.md) | Every scheduled job (Vercel Cron), its timing, and the email-send safeguards. |
| [07 — Business Rules](07-business-rules.md) | The tricky definitions (occurred, live/virtual, new client, feedback, etc.) and where each lives. |
| [08 — Runbook](08-runbook.md) | Step-by-step: run a sync, apply SQL, handle a deletion, fix common problems. |
| [09 — Configuration](09-configuration.md) | Every environment variable and the external project references. |
| [10 — Outreach Status](10-to-do-list.md) | The Clients → Outreach Status worklist (formerly "To-Do List"; the route and view are still `to-do` / `v_client_todo`): every column's definition, the aging thresholds, notes storage, and its client scoping. |
| [11 — OOO Summary](11-ooo-summary.md) | The per-person/per-year/per-type time-off tally behind `/ooo-summary`: the four categories, NYSE business-day counting, and the comment-driven half-day rule. |
| [14 — Tasks (all CRM)](14-tasks.md) | The super-user-only `/tasks` page: every CRM task with no row scoping, its nine list columns, the four-section detail drawer, the Open-tasks default, and the two field-sourcing judgement calls (priority precedence, and owners that are not always people). **SQL patch still to run.** |
| [13 — Events (all CRM)](13-events.md) | The super-user-only `/events` page: every marketing event with no row scoping, its seven list columns, the General/Planning detail drawer, the Current & Upcoming default, and the shared table machinery it runs on with Meetings. |
| [12 — Meetings (all CRM)](12-meetings-all.md) | The super-user-only `/meetings` page: every CRM meeting with no row scoping, its **saved views** (system + personal, with defaults), the column catalog behind Edit columns, the Edit filters builder, and why the route — and the app's first write path — are gated the way they are. |
| [20 — Clients (all CRM)](20-clients.md) | The super-user-only `/accounts` page: every client in the CRM, active **and** inactive — the account record itself, and how it differs from the Portfolio client table. The three disagreeing "status" fields, the two derived buckets it inherits from Portfolio, why it uses only already-flattened columns, and the account-team question it deliberately does not answer. **SQL patch still to run.** |
| [22 — Cutover: the ownership boundary](22-cutover-ownership-boundary.md) | **Live dashboard writes: Contacts, Notes, Touches, Tasks, Meetings, Events** (all but Contacts are swept; Add New Client still inert). **Dashboard-created records are editable in their drawer; Dynamics records stay read-only until cutover** (origin guard enforced server-side) (Add New, TEST badge, test purge; test data flows through unfiltered, contained by the ZVZZT test client). The `origin` / `is_test` fence that keeps the Dynamics sync and deletion sweep off dashboard-authored rows: the origin-lock trigger, `_synced_at` for dashboard rows, and the rollout order. **Prerequisite for any dashboard write.** |

## Orientation in one paragraph

The dashboard is a **read-only window** onto data that lives in Microsoft Dynamics 365. A background job copies Dynamics records into a Supabase (Postgres) database on a schedule; Postgres **views** reshape that raw data into the exact tables and numbers each page needs; and the Next.js website simply reads those views. Nothing you do in the dashboard writes back to Dynamics. A handful of "Rose-owned" tables (costs, salaries, overheads) are the exception — those are entered directly in the admin pages and are never touched by the sync. See [00 — Architecture](00-architecture.md) for the full picture.
