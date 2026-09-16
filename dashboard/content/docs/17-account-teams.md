# 17 — Account Teams & Client Status (Admin)

> **Status: built, SQL PENDING.** The page is at `/admin/account-teams`, reached from the **Admin hub** → *In-app tools* → **Account Teams**. Super-user only.
>
> **Two patches to run: `sql/patches/2026-09-15_account_team_members.sql` and `sql/patches/2026-09-15b_account_status.sql`. Neither has been run yet.** Until it is, the page loads and gates correctly, shows every role as unassigned, and displays a banner naming the patch — it fails soft, it does not crash. The patch creates the table, its indexes, and the CRM seed. The table is also in the base DDL (`sql/02_rose_owned_tables.sql`).
>
> **Not yet pushed to any remote.** The application code is local-only.

## ⚠️ Setup only — this changes nothing yet

**`account_team_members` and `account_status` are read and written by exactly one page — `/admin/account-teams` — and by nothing else.** They are deliberately **not** wired into:

- `teamAccountIds` or `resolveClientScope`
- anything in `lib/access/` (data scopes, client scope, meeting scope, financials)
- `lib/account-team.ts` — the **existing** four-role module that still powers the avatar clusters on Portfolio, Profiles and the Events Client column, read straight off the `public.accounts` `*_name` columns
- any CRM or reporting page
- any query's `WHERE` clause — nothing filters on the owned status

Editing a team **or a client's Active/Inactive status** on this page changes **that page and nothing else**. It does not affect who can see which client, any report, any permission, or any avatar anywhere in the app.

**Forward intent:** this table is meant to become the source of truth for account-team-based CRM visibility. When that happens, `lib/account-team.ts` becomes a reader of this table rather than of `accounts`, and the scope layer starts consulting it. **That is a separate, deliberately-reviewed change.** Until then, nothing may import `lib/account-teams/roles.ts` into a scope or permission path.

## The six roles, and where each was seeded from

`public.accounts` carries exactly six `systemuser` lookups naming a person in an account-team role. Five map by their obvious name. The sixth needed work.

| Role | CRM lookup (`_raw`) | `accounts` column | Seeded rows |
|---|---|---|---|
| `account_manager` | `_bcs_salesleadprimary_value` | `sales_lead_primary_id` | 158 |
| `secondary_manager` | `_bcs_secondarymanager_value` | `secondary_manager_id` | 72 |
| `feedback_report` | `_bcs_feedbackreport_value` | `feedback_report_id` | 152 |
| `associate` | `_bcs_associate_value` | `associate_id` | 136 |
| **`memo`** | **`_bcs_teaser_value`** | **`teaser_id`** | **148** |
| `logistics` | `_bcs_logisticscoordinator_value` | `logistics_coordinator_id` | 135 |

**801 assignments across 158 of the 228 accounts.** Each role's source field is also shown in small type under its label on the page itself, so the mapping is visible where it is being edited rather than buried in a migration.

### Memo = Teaser — confirm this one

**There is no "memo" field on `public.accounts`.** All 403 `_raw` keys were searched; none matches `/memo/i`. `teaser` is the only remaining person-role lookup, and the evidence that it is the memo owner is strong:

1. **The repo already made this call.** `lib/events/record.ts` and [13 — Events](13-events.md) map the Events drawer's "Memo Date" / "Memo Not Required" onto `events.teaser_date` / `teaser_not_required`, flagged there as an assumption. Rose's CRM calls the artefact a *teaser*; the dashboard calls it a *memo*.
2. **The people line up exactly.** The owners of the 1,092 live tasks with sub-type "Marketing Memo" are, by initials: **YL 626, SW 140, MB 118, GF 102, DC 78**. The people holding `accounts.teaser_id` are **Yan Lager 134, Douglas Cooper 4, Marlowe Burke 4, Gary Farber 3, Simon Willcocks 2** — the same five people, same dominant name.
3. **The alternative does not fit.** `_bcs_targeting_value` is Joseph Saggese on 128 of its 129 accounts. That is the targeting analyst, not the memo writer.

**If this is wrong**, change one line — the `memo` branch of the seed's `crm` CTE in the patch — and re-run. Nothing else depends on it.

### Unmatched people: none

The `accounts.*_id` columns are already declared `REFERENCES public.users(user_id)`, and **every one of the 801 values honours it**. There is no name- or email-matching step and nothing was dropped. The patch still ships an unmatched-people report query, which returns zero rows today, so future CRM drift shows up instead of being silently swallowed by the seed's `EXISTS` guard.

### 38 assignments point at inactive employees

| Person | Assignments |
|---|---|
| Shawna Giust | 14 |
| Douglas Cooper | 8 |
| Gary Farber | 6 |
| Victoria Kemp-Sesny | 4 |
| Simon Willcocks | 4 |
| Rosa Trivigno | 2 |

They are seeded anyway — that is what the CRM currently says — and the editor **shows them, flagged "inactive employee"**, rather than rendering the slot as empty. They are not offered in the assignment dropdown, so the only way to keep one is to leave it alone; reassigning is a deliberate act.

## Client status (Active / Inactive) — owned, seeded, wired to nothing

A second owned thing lives on this page: a per-client **Active / Inactive** flag in `public.account_status`.

### Source field: `accounts.state_label`

| | |
|---|---|
| **Seeded from** | `public.accounts.state_label` — the Dynamics statecode (`state_code` 0 = Active, 1 = Inactive) |
| **Live split** | Active **106** / Inactive **122**, across 228 accounts |

`accounts.status_label` is perfectly redundant with it — the same 106/122 split, `statuscode` 1/2 tracking `statecode` 0/1 exactly — so either would do and `state_label` is the canonical Dynamics one. There is no `accounts.is_active` column.

**`accounts.client_status_label` was deliberately NOT used.** It is a separate Rose business field (Current 89 / Past 71 / null 68) and it disagrees with the Dynamics state on 33 accounts — 32 are `Inactive | Current` and one is `Active | Past`. Seeding from it would have produced a different, wrong answer.

### ⚠️ The CRM field is still load-bearing — this one is not

`WHERE state_label = 'Active'` appears in roughly **fifteen places in `sql/03_views.sql`** (`v_client_portfolio` and friends) and in `app/institution-style/page.tsx`. **None of them know `account_status` exists, and this work changed none of them.**

So the two flags can diverge the moment someone uses the toggle, and **that divergence is inert by design**: the owned flag records Rose's intent, the CRM flag still drives the app. Reconciling them — pointing an existing view at `account_status` — is a separate, deliberate change and must not be done as a drive-by.

The check that proves it: `SELECT count(*) FROM public.v_client_portfolio` is **106** today and must not move when anyone toggles.

### The table

`public.account_status` — one row per account, `account_id` as the **primary key** (a client has exactly one state, and that makes the seed a plain `ON CONFLICT` upsert).

| Column | Notes |
|---|---|
| `account_id` | uuid **PK**, FK → `accounts`, `ON DELETE CASCADE` |
| `is_active` | boolean **NOT NULL** — every row states a position; "no opinion" is the *absence* of a row |
| `source` | `'crm_seed'` or `'manual'` |
| `changed_at` | when the **status** changed — set explicitly by the action, not by a row-touch trigger, so a no-op save does not look like a change |
| `changed_by` | the actor's email; `'crm_seed'` for seeded rows |

Kept as its own table rather than a column on `account_team_members`: that table is per *(account, role)* and would carry the flag six times per client, with six chances to disagree with itself. There was no existing owned accounts-overlay to extend — the other owned tables keyed on an account (`client_direct_costs`, `overhead_overrides`, `revenue_overrides`) are per-period financial records, not per-account attributes.

### The seed

One upsert over all 228 accounts, mapping `state_label = 'Active'` → `true`. The `WHERE public.account_status.source = 'crm_seed'` on the `DO UPDATE` branch is the whole safety story: a row a human has set to `'manual'` is matched by the conflict, then filtered out of the update — so it is neither inserted nor modified.

`COALESCE(state_label, '') = 'Active'` guards a future null by treating an unknown state as **inactive** rather than silently active. (All 228 live rows are non-null today.)

### The toggle

On the per-client editor, above the six role slots. **Three states, not two:** Active, Inactive, and **Not set** — no row yet. "Not set" is shown rather than defaulted to Active, because an unseeded database defaulting to Active would look like somebody had decided.

Two explicit buttons rather than a switch: a switch has no way to show the third state, and it invites an accidental flip on a control meant to be a deliberate decision. The client roster on the left also carries a quiet status dot per row (green = active, grey = inactive, pale = not set) — **display only; it does not filter the list.**

Saving writes `source = 'manual'`, which is what makes it survive the next CRM re-seed. Toggling therefore takes a client's status out of the CRM's hands permanently — the same ownership rule the role slots follow.

## The table

`public.account_team_members` — **dashboard-owned**, not a Dynamics mirror. No `_raw`, no `_synced_at`, and the sync never writes to it.

| Column | Notes |
|---|---|
| `id` | uuid PK |
| `account_id` | FK → `accounts`, `ON DELETE CASCADE` |
| `role` | text + CHECK over the six values |
| `user_id` | FK → `users`, **`ON DELETE RESTRICT`** — silently dropping a team assignment because a users row vanished would be quiet data loss |
| `source` | `'crm_seed'` or `'manual'` |
| `created_at` / `updated_at` | `updated_at` maintained by the shared `touch_updated_at` trigger |
| `created_by` / `updated_by` | the actor's email, stamped server-side; `'crm_seed'` for seeded rows |

RLS is on with **zero policies**, so only `service_role` reaches it; the anon key that ships in the browser gets nothing. Authorisation lives in the server actions.

### Why there is no `UNIQUE (account_id, role)`

The UI allows **one assignee per slot** today, and that is enforced in the **server action**, not the schema. The schema deliberately permits several people in one role so that "two associates on this account" becomes a UI change rather than a migration plus backfill.

The one unique index — `(account_id, role, user_id)` — blocks only the meaningless case: the same person listed twice in the same role on the same account. (Verified: the CRM has exactly one person per slot today, so all 801 rows are distinct on both keys.)

If one-per-slot is ever wanted as a hard rule, add `CREATE UNIQUE INDEX … ON account_team_members (account_id, role)` and the seed's manual-edit guard still holds.

## The re-runnable seed

Three statements sharing one CTE — the six `accounts` columns unpivoted into `(account_id, role, user_id)`.

**The manual-edit rule, stated once:** a *slot* is `(account_id, role)`. If any row exists for that slot with `source = 'manual'`, the seed leaves **the whole slot alone** — it will not delete, insert or update anything in it. A human has spoken; the CRM does not get to argue.

- **(a) DELETE** `crm_seed` rows the CRM no longer agrees with — skipping human-owned slots.
- **(b) INSERT** what the CRM names and we do not have — skipping human-owned slots. `ON CONFLICT (account_id, role, user_id) DO UPDATE … WHERE source = 'crm_seed'` re-affirms an unchanged row without ever flipping a manual row back to seeded.
- **(c)** Nothing else. Slots the CRM leaves empty stay empty.

Re-running after a CRM change moves the person: (a) removes the stale row, (b) inserts the new one. Re-running with no change is a no-op apart from touching `updated_at`.

## The page

**Left:** a searchable list of all 228 clients, each row showing name, ticker, the team as an avatar cluster, and an `n/6` filled count — enough to scan across clients without a full clients × roles grid. (The grid is the brief's optional extra; the picker plus editor is v1, and the per-row cluster covers most of what a grid would be used for.)

**Right:** the six role slots for the selected client. Each shows the current assignee (avatar + name + whether it came `from CRM` or is `manual`), a searchable dropdown of assignable employees, and a **Clear** button.

The **assignable roster** is active `@roseandco.com` humans. It reuses `buildIdentityIndex` from `lib/access/identity-index.ts` **read-only** — that pure module already encodes which rows are people: it drops non-Rose domains and Dynamics-disabled rows whose local-part is a 32-hex hash, and tags shared mailboxes (`conference*`, `ga`, `corporateaccess`, `dmgsupport`, `externaldev`, `#`-prefixed names) as `service`. Re-deriving that here would be a second copy of a rule that must not drift; importing it changes nothing about how it behaves elsewhere. Of the 50 active `@roseandco.com` rows, that leaves the real employee list.

Three people (**Blair Mutschler, Brian Smith, Simon Rose**) have two mailboxes and therefore two `user_id`s. Both appear in the dropdown — either may be the one the CRM used — and the email is shown under the name **only** where the name alone is ambiguous.

All the data ships with the page (228 accounts, ~801 assignments, ~50 people), so switching clients is instant with no round-trip. After a write the page refreshes, so the server stays the single source of truth and the component keeps no optimistic copy to drift.

### Saving, and what it means

- **Assign** deletes the slot and inserts one row with `source = 'manual'`. That is what makes it survive the next CRM re-seed — so re-assigning a seeded slot takes it out of the CRM's hands **permanently**. That is the intent: this page is the system of record going forward.
- **Clear** deletes the slot. A cleared slot becomes **re-seedable** — with no manual row present, the next seed puts the CRM's person back. Clearing means "no Rose-owned override here", not "keep this permanently empty". A permanently-empty slot would need a tombstone row, which is a schema change and out of scope.

## Security

Three independent gates, all server-side:

1. **`lib/access-control.ts` `ADMIN_ONLY_ROUTES`** now includes `/admin/account-teams` — super-user-only, and **not** grantable to another role through the Admin → Roles matrix. It is deliberately **not** in `CRM_NAV_ITEMS`: this is an admin tool, not a CRM data table.
2. **`proxy.ts`** runs `canAccessRoute` before the page renders.
3. **`app/admin/account-teams/page.tsx`** re-checks the **effective** role before it builds any query.

Every server action re-checks independently via **`requireSuperUser()`**, which resolves the **real** role — the same guard `admin/users` and the admin API routes use.

**The read gate and the write gate deliberately differ.** Reads use the *effective* role, so a super-user in "View as" previews the denial as the impersonated person would see it. Writes use the *real* role, because previewing must not be able to save and the real identity is what gets stamped into `updated_by`. The UI hides the controls while impersonating rather than offering a doomed click — the same pattern as the CRM pages' `readOnlyViews`.

**Verified:** unauthenticated `/admin/account-teams` → `307` to `/login?next=%2Fadmin%2Faccount-teams`.

### Write validation — fail loud

Every write validates server-side against the database, never trusting the client:

- `role` is one of the six (checked in the action **and** by the CHECK constraint)
- `account_id` exists in `public.accounts`
- `user_id` is an **active, non-service** `@roseandco.com` person — re-derived from the roster at write time, not taken on trust
- `created_by` / `updated_by` (and `changed_by` for status) are stamped from the resolved identity
- the status value must be a real boolean; `account_id` must exist

A failed check returns the reason and writes nothing.

## Where things live

| Concern | File |
|---|---|
| Route + gate + bulk load | `dashboard/app/admin/account-teams/page.tsx` |
| Server actions (roster, assign, clear, set status) | `dashboard/app/admin/account-teams/actions.ts` |
| Client list + six-slot editor + person picker | `dashboard/app/admin/account-teams/account-teams-view.tsx` |
| Role keys, labels, colours, CRM source fields | `dashboard/lib/account-teams/roles.ts` |
| Owned status types + the "not the CRM flag" warning | `dashboard/lib/account-teams/status.ts` |
| Route gating | `dashboard/lib/access-control.ts` (`ADMIN_ONLY_ROUTES`) |
| Admin hub tile | `dashboard/app/admin/page.tsx` |
| SQL — teams (table + seed) | `sql/patches/2026-09-15_account_team_members.sql` |
| SQL — status (table + seed) | `sql/patches/2026-09-15b_account_status.sql` |
| Base DDL | `sql/02_rose_owned_tables.sql` |

**Not** `dashboard/lib/account-team.ts` — that is the separate, existing, live four-role avatar module, unchanged and still reading `public.accounts`.
