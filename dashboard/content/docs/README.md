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
| [10 — To-Do List](10-to-do-list.md) | The Clients → To-Do List worklist: every column's definition, the aging thresholds, notes storage, and its client scoping. |

## Orientation in one paragraph

The dashboard is a **read-only window** onto data that lives in Microsoft Dynamics 365. A background job copies Dynamics records into a Supabase (Postgres) database on a schedule; Postgres **views** reshape that raw data into the exact tables and numbers each page needs; and the Next.js website simply reads those views. Nothing you do in the dashboard writes back to Dynamics. A handful of "Rose-owned" tables (costs, salaries, overheads) are the exception — those are entered directly in the admin pages and are never touched by the sync. See [00 — Architecture](00-architecture.md) for the full picture.
