# 20 — Clients (CRM)

## What it does (plain language)

**Clients** is the seventh CRM table, at `/accounts` — the **first** entry in the CRM block at the bottom of the nav rail, above Meetings. It lists **the companies Rose works for** — the mirror of the Dynamics `account` entity — with their ticker, account team, sector, region, market-cap band, engagement dates and the Yes/No flags the CRM keeps on them.

It works exactly like Meetings, Events, Tasks, Touches, Notes and Contacts: pick a saved view, narrow it with the dropdowns, add or remove columns, sort, search, export to Excel, and click any row to slide out the full record.

**It is read-only.** Nothing on this page creates, edits or deletes a client — Dynamics is the system of record. The "Add New Client" button is a placeholder, same as the other six.

**It is super-user only.** The page returns every client with no row scoping, including the ~121 *inactive* ones no other page shows.

### ⚠️ This is NOT the Portfolio client table

Both are "the client table" and they are **different things on purpose**:

| | **Portfolio** (`/portfolio`) | **Clients** (`/accounts`) — this page |
|---|---|---|
| What it is | the **analytics rollup** | the **record itself** |
| Which clients | active only (~107) | every client, active *and* inactive (228) |
| Where the data comes from | `v_client_portfolio` — accounts **joined to** meetings, contracts and notes | `v_admin_accounts_all` — the account row, nothing joined |
| Typical columns | meeting counts, retainer, open slots, next meeting, latest note status | ticker, account team, sector/region/cap, engagement dates, flags, provenance |
| Who can see it | grantable through Admin → Roles | super-user only, **not** grantable |
| Saved views / record drawer | no | yes |

Neither replaces the other, and neither reads the other. If you want "how busy is this client?", that is Portfolio. If you want "what does the CRM actually hold on this client?", that is here.

The **route is `/accounts`** because the Dynamics entity, the mirror table and the view are all `account`; only the label says "Clients". Same split as Touches, whose route stays `/touchpoints`. It deliberately avoids `/clients/*` (the scoped Outreach Status worklist) and `/portfolio`.

> **Run the patch first.** Until `sql/patches/2026-09-17_admin_accounts.sql` has been run in Supabase, the page renders an error card naming the missing view. The mirror table itself is already populated by the nightly sync.

## Technical

### Files

| File | Role |
|------|------|
| `sql/patches/2026-09-17_admin_accounts.sql` | The two views, the extra indexes, and `account_saved_views`. |
| `dashboard/app/accounts/page.tsx` | The gated loader. |
| `dashboard/app/accounts/accounts-view.tsx` | The virtualised table. |
| `dashboard/app/accounts/account-record-pane.tsx` | The slide-in record drawer. |
| `dashboard/app/accounts/actions.ts` | Server actions — record fetch, export, saved views, filter options. |
| `dashboard/lib/accounts/record.ts` | Drawer field definitions + `AccountRecord`. |
| `dashboard/lib/accounts/spec.ts` | Column catalog, built-in views, `ACCOUNTS_SPEC`. |
| `dashboard/lib/accounts/filters.ts` | The eleven quick filters. |

Everything else is shared: `lib/table-views/` (query, config, saved views, Excel) and `components/table-views/` (view switcher, column editor, filter editor, quick-filter bar). Nothing about filtering, paging, saved views or authorisation is written again for this page — see the header of `lib/table-views/types.ts`.

No new mirror table and **no new columns**: `public.accounts` already existed, and this patch only adds a read layer plus indexes.

### The views

**`v_admin_accounts_all`** — one row per account, **no joins at all**. Unlike its six siblings there is nothing to resolve a client link against: the row *is* the client. It exposes display columns only and **never `_raw`**.

It also exposes `client_account_id` / `client_account_name` / `client_ticker` — aliases of the account's own id, name and ticker under the names every other admin view uses, so the shared ticker renderer and the `/client-detail` link work here unchanged.

**`v_admin_accounts_filter_options`** — the usual `(kind, value, label, count)` shape. Eleven kinds: `state`, `client_status`, `sector`, `industry`, `region`, `market_cap`, and the five team roles `account_manager` / `secondary` / `associate` / `feedback` / `logistics`.

This is the **one** options view in the set that reads the entity's *view* rather than the base table. Two of the eleven kinds are derived (see below), and a dropdown offering a bucket the list cannot match is a dead option; reading the view guarantees both come from the same expression. The usual cost argument does not apply — accounts is 228 rows and the view joins nothing.

`state` comes back as **text** (`"0"`/`"1"`) because the options view is one `UNION` and every branch must share a column type; `lib/accounts/filters.ts` converts it back to an integer before querying. Passing the string through would make PostgREST compare `integer = '0'`, which either errors or silently matches nothing.

### Only already-flattened columns

Every column on the view is a real column on `public.accounts`. **Nothing is flattened out of `_raw` in this build.**

The ~40 accounts fields still held only in `_raw` — the staff-initials cluster, the `address1_*` block, and others — remain absent. Promoting them is a **separate, dedicated accounts flatten pass**, still to do. The drawer already fetches `_raw` for the open record, so when that pass lands, adding a field needs no second query.

**Contract, retainer and days-left are deliberately absent.** They are not accounts columns — they live on `public.contracts` — so they fall outside "already flattened onto the account row". Retainer is additionally a *field-level* permission (the Financials grant), which is a second reason not to put it on an unscoped CRM table. Portfolio is where retainer lives today.

### ⚠️ Two derived columns inherit Portfolio's quirks

`region_label` and `market_cap_label` are `CASE` expressions, **copied verbatim from `v_client_portfolio`** so a client's region and cap band read the same on both client tables. That means they inherit its NULL handling:

- A client with **no market cap on record** lands in **`Micro`**, not in an "Unknown" bucket.
- A client with an **unrecognised or missing HQ country** lands in **`EMEA`**.

Both raw columns (`market_cap_b`, `hq_country_name`) are exposed as their own columns, so the underlying value is always one click away in the column picker. The alternative — an honest "Unknown" bucket — was rejected because the two client tables silently disagreeing about the same client is worse than a documented quirk. (`v_client_stats_by_market_cap` *does* use `Unknown`; that is a pre-existing difference, not one introduced here.)

The patch ships a check query that fails loudly if the two ever drift apart.

### ⚠️ There are three "status" fields and they disagree

| Column | What it is | Values |
|---|---|---|
| `state_label` / `state_code` | the **Dynamics statecode** | Active (0) / Inactive (1) |
| `client_status_label` | a **Rose business field** (`bcs_ClientStatus`) | Current / Past / blank |
| `status_label` | the Dynamics statuscode | redundant with `state_label` today |

`state_label` is the one the default view filters on, and the one ~15 views in `sql/03_views.sql` already mean by "active client". `client_status_label` **disagrees with it on 33 accounts**. Both are default-visible columns and both have their own dropdown — collapsing them into one control would have to pick a winner silently.

A **fourth** flag exists: `public.account_status`, the dashboard-owned Active/Inactive toggle on `/admin/account-teams`. It is setup-only, read by nothing else, and deliberately **not** on this view. See [17 — Account Teams](17-account-teams.md).

### ⚠️ The engagement dates are the CRM's own rollups

`last_touchpoint_date`, `last_event_date`, `days_since_last_review` and the rest are computed **in Dynamics** and passed through unchanged. They are known to lag what `public.meetings` and `public.events` actually contain.

On a system-of-record page that is the right thing to show — it is what the CRM believes — but **do not use them as reporting figures**. Portfolio computes its own counts off `public.meetings` for exactly this reason. The drawer says so under the Engagement block.

### The account team is displayed, not decided

The five team fields the brief asked for — manager / secondary / associate / feedback / logistics — are shown **read-only**, exactly as they sit on `accounts`. Three more already-flattened staffing lookups (targeting, teaser, primary contact) ride along in the drawer and the column picker.

The Client column's **avatar cluster** is the same component, the same four roles, the same colours and the same global initials directory as the Client Portfolio and Events clusters (`lib/account-team.ts` `ACCOUNT_TEAM_ROLES`, `components/account-team-avatars.tsx`). **No new team source was introduced.** Unlike Events — which has to bulk-read `accounts` by `account_id` and merge the team in — here the row *is* the account, so the four name columns are already on it (they are in `ACCOUNT_ALWAYS_SELECT`, so the circles do not appear and disappear with the view's column list).

`public.account_team_members` — the second, dashboard-owned team table — is **not read or written** by this page. Which of the two becomes the source of truth is an open question and is **not** answered here; it is a separate follow-up alongside the flatten pass.

### The five team filters match on the NAME, not the user id

The sibling pages expand an owner filter across `public.canonical_user_id`, because two people in this CRM carry duplicate `systemuser` records: filtering on one of their ids silently returns half their clients.

This page sidesteps that rather than re-implementing it. The five team dropdowns are keyed on the **display name** — both duplicate records carry the same name, so matching on it unions them for free, and there is no alias table to load. The trade-off is that two genuinely different people sharing a display name would merge; nobody in this directory does, and such a collision would be *visible* as a duplicate dropdown entry, whereas a split id is invisible and reads as missing clients.

### Saved views

`account_saved_views` — identical shape and identical rules to the six sibling tables, enforced by the one shared module at `lib/table-views/saved-views.ts`. System + personal scopes, one default each, RLS on with zero policies so only `service_role` reaches it.

The name was chosen to sit with its siblings and to stay clear of the two other account-keyed owned tables, `account_team_members` (per account *and* role) and `account_status` (the owned flag). It references neither.

**No seed row.** The two built-in views are defined in **code** at `lib/accounts/spec.ts`, like every other entity's presets — so they always exist and no fresh database can miss a seeding step:

- **Active clients** (the default) — `is_active` is true, sorted by name A→Z. `is_active` is computed by the view on every query as `state_code = 0`, so a client deactivated in Dynamics leaves the view on the next sync with no edit anywhere.
- **All clients** — no filter. This matters more here than on any sibling: roughly **half** the mirror (121 of 228) is inactive, and Portfolio cannot show any of it.

Default visible columns: **Client** (ticker link + account-team avatars) · Status · Client Status · Sector · Region · Cap Band · Last Touch. Everything else is one click away in **Edit columns**.

### Security

`v_admin_accounts_all` is **unscoped** and is read with the **service-role key, which bypasses RLS**. Three independent gates stand in front of it:

1. `proxy.ts` runs `canAccessRoute` before the page renders, and `/accounts` is in `ADMIN_ONLY_ROUTES` — super-user-only, and **not** openable through Admin → Roles.
2. `app/accounts/page.tsx` re-checks the **effective** role before it constructs a query.
3. Every server action in `app/accounts/actions.ts` re-checks it again — a server action is its own entry point and can be invoked directly.

The role is the *effective* one, so a super-user using **View as** previews the denial exactly as the impersonated person would experience it. Neither `?view=` nor `?cfg=` is a security boundary: saved views are filtered to what the caller may see, and a config can at most widen the result back to what "All clients" already returns to the same caller.

The **list never selects `_raw`**. Only the drawer's single-row fetch reads it, straight off `public.accounts`, and a failure there is non-fatal — every rendered field came from the view.

Note that `/portfolio` is **unaffected** by any of this: it remains a normal, matrix-grantable reporting page.

### Indexes added

On `public.accounts`: `sector_label`, `client_status_label`, `hq_country_name`, `market_cap_b`, `last_touchpoint_date DESC`, and the five team name columns. `name`, `ticker_symbol`, `(state_code, status_code)` and `modified_on DESC` already existed and cover the default sort and the Active dropdown.

At 228 rows none of these changes a plan today; they are there so the page does not start sequential-scanning if the mirror grows an order of magnitude.

## Still to do (separate tasks)

1. **The accounts field-flatten pass** — promote the ~40 fields still living only in `_raw` (staff initials, `address1_*`, …) to real columns, then add them here. Nothing about this page needs to change structurally when that lands.
2. **The account-team source-of-truth decision** — Dynamics fields on `accounts`, or the dashboard-owned `account_team_members`. This page displays the former and takes no position.
3. **Editing.** The drawer is styled and structured to flip to editable at cutover (swap the read-only renderer for an input keyed off each field's `type`), but must not until the dashboard actually becomes the system of record.
