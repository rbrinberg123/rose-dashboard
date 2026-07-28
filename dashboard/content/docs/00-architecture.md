# 00 — Architecture

## What it does (plain language)

The dashboard is a **read-only window** onto the firm's data. The real system of record is **Microsoft Dynamics 365** (the CRM, also called Dataverse), where the team logs accounts, meetings, contracts, notes, and tasks. The dashboard never edits Dynamics. Instead:

1. A **sync job** copies Dynamics records into a **Supabase** database (hosted Postgres) on a schedule.
2. Postgres **views** reshape that raw copy into exactly the tables and numbers each page needs.
3. The **Next.js website** reads those views and displays them.

So when you look at a page, you're seeing a recent *copy* of Dynamics, reshaped by a view. If a number looks wrong, the cause is almost always in one of those three layers — the copy is stale, the view logic, or the source data in Dynamics.

A small set of numbers (costs, salaries, overhead) don't exist in Dynamics at all. Those are typed directly into the dashboard's admin pages and stored in **Rose-owned tables**, which the sync never overwrites.

## The stack

| Layer | Technology |
|-------|-----------|
| Source of record | Microsoft Dynamics 365 / Dataverse (Web API) |
| Sync | TypeScript, run as a scheduled Vercel Cron job (`/api/sync-dynamics`) |
| Database | Supabase (managed Postgres) |
| Calendars | Microsoft Graph API (free/busy for the Host Calendar & Conference Rooms) |
| Web app | Next.js 16 (App Router, Turbopack), React, Tailwind |
| Hosting | Vercel (web app + cron jobs) |
| Auth | Supabase magic-link email login |

> **Note on the root `README.md`:** the repo-root `README.md` describes an older model (a Python loader on Render). The *current* system uses the TypeScript sync in `dashboard/lib/sync/` on **Vercel Cron**. Where the two disagree, this doc set reflects the code that actually runs. The Python loader (`loader/load.py`) still exists as a manual/backfill fallback and is deliberately kept in lockstep with the TypeScript mappers.

## Data flow

```
Microsoft Dynamics 365 (Dataverse)
        │
        │  incremental sync — only records changed since last run
        │  (Vercel Cron → /api/sync-dynamics → lib/sync/*)
        ▼
   ┌───────────────────────── Supabase (Postgres) ─────────────────────────┐
   │                                                                        │
   │  MIRROR TABLES (sync-managed, overwritten)   ROSE-OWNED (admin-typed)  │
   │  ───────────────────────────────────────     ──────────────────────   │
   │  accounts   meetings   touchpoints            cost_assumptions         │
   │  users      client_notes   contracts          salary_schedule          │
   │  tasks      events    new_vacationrequest      client_direct_costs      │
   │                                               overhead_periods          │
   │  OPS TABLES (sync bookkeeping)                overhead_overrides        │
   │  ──────────────────────────                   revenue_overrides         │
   │  sync_runs   sync_errors                                                │
   │  deletion_candidates   reconcile_runs                                   │
   │  cron_send_log   user_roles                                             │
   │                                                                        │
   │  COMPUTED VIEWS  (v_*)  — reshape the above into page-ready shapes      │
   └────────────────────────────────────────────────────────────────────────┘
        │
        │  Next.js pages read views via the service-role server client
        ▼
   Next.js dashboard on Vercel  →  the browser (behind magic-link auth + role gate)
```

The Microsoft Graph integration is a **side channel**: the Host Calendar and Conference Rooms pages call Graph directly (through `/api/*` routes) for live free/busy, rather than reading a mirror table.

## The golden rule: editing a SQL file does **not** change the database

The `sql/` folder (at the **repo root**, `rose-dashboard/sql/`, not under `dashboard/`) holds the table and view definitions. **These are not migrations that run automatically.** They are scripts a human runs by hand in the **Supabase SQL editor**.

That means:

- Editing `sql/03_views.sql` locally changes *nothing* in the live database until someone pastes it into Supabase and runs it.
- The files are written to be **idempotent** (safe to re-run) — `create or replace view`, `create table if not exists`.
- To change a deployed table's columns you generally add an `ALTER TABLE` script under `sql/patches/` (the observed convention), because `create table if not exists` won't alter an existing table.

See [08 — Runbook](08-runbook.md) for the exact "apply SQL in Supabase" steps.

## Technical

- **Sync entry point:** `dashboard/app/api/sync-dynamics/route.ts` → `runSync()` in `dashboard/lib/sync/run.ts`. Entity list in `dashboard/lib/sync/entities.ts`. Field mapping in `dashboard/lib/sync/mappers.ts`. Dynamics Web API client in `dashboard/lib/sync/dynamics.ts`. Full detail in [05 — Sync & Integrations](05-sync-and-integrations.md).
- **Database reads:** pages use the service-role Supabase client from `dashboard/lib/supabase.ts` (`getSupabaseServer()`), which bypasses RLS and is **server-only** — never imported into a client component.
- **Graph:** `dashboard/lib/graph/*` (separate Azure app; see the two-apps caveat in [05](05-sync-and-integrations.md) and [09](09-configuration.md)).
- **Auth & routing gate:** `dashboard/proxy.ts` + `dashboard/lib/access-control.ts` (see [01 — Access & Users](01-access-and-users.md)).
- **Cron schedule:** `dashboard/vercel.json` (see [06 — Automations](06-automations.md)).
- **RLS posture:** no meaningful row-level security in v1 — all reads go through the service-role key server-side. `user_roles` / `cron_send_log` have RLS *on with no policies* (so only the service-role client can touch them). See [03 — Data Model](03-data-model.md).
