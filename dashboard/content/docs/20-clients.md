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
| `dashboard/lib/accounts/filters.ts` | The seven quick filters (Active, Client Status, Feedback and Logistics removed 2026-10-08). |

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

**Update 2026-10-02b:** see [Account team: the source of truth](#account-team-the-source-of-truth-2026-10-02b). Dashboard-created clients take their team from `account_team_members`; Dynamics clients keep the Dynamics fields above.

### The five team filters match on the NAME, not the user id

The sibling pages expand an owner filter across `public.canonical_user_id`, because two people in this CRM carry duplicate `systemuser` records: filtering on one of their ids silently returns half their clients.

This page sidesteps that rather than re-implementing it. The five team dropdowns are keyed on the **display name** — both duplicate records carry the same name, so matching on it unions them for free, and there is no alias table to load. The trade-off is that two genuinely different people sharing a display name would merge; nobody in this directory does, and such a collision would be *visible* as a duplicate dropdown entry, whereas a split id is invisible and reads as missing clients.

### Saved views

`account_saved_views` — identical shape and identical rules to the six sibling tables, enforced by the one shared module at `lib/table-views/saved-views.ts`. System + personal scopes, one default each, RLS on with zero policies so only `service_role` reaches it.

The name was chosen to sit with its siblings and to stay clear of the two other account-keyed owned tables, `account_team_members` (per account *and* role) and `account_status` (the owned flag). It references neither.

**No seed row.** The two built-in views are defined in **code** at `lib/accounts/spec.ts`, like every other entity's presets — so they always exist and no fresh database can miss a seeding step:

- **Active clients** (the default) — `is_active` is true, sorted by **Last Touchpoint, most recent first** (blanks last). `is_active` is computed by the view on every query as `state_code = 0`, so a client deactivated in Dynamics leaves the view on the next sync with no edit anywhere.
- **All clients** — no filter, same columns and sort. This matters more here than on any sibling: roughly **half** the mirror (121 of 228) is inactive, and Portfolio cannot show any of it.

Default visible columns are listed in the next section. Everything else is one click away in **Edit columns**. Personal and system saved views keep their own column lists and are unaffected.

### Default view and per-role Account Team (2026-10-02)

**Patch:** `sql/patches/2026-10-02_accounts_default_view.sql` **(run in Supabase)**. Until it's run, the nine new columns show "—" and the sort falls back to client name.

**Default columns, in order:**

| # | Column | Source |
|---|--------|--------|
| 1 | Ticker | `ticker_symbol` (frozen) |
| 2 | Client Name | `client_account_name` (frozen) |
| 3 | **Account Team**, one column per role — **except Fbk and Memo** | `team_<role>` (Pri · Sec · Assoc · Log) |
| 4 | Sector | `sector_label` |
| 5 | Region | `region_label` |
| 6 | Cap | `market_cap_label` (the band; the raw $B is in the picker) |
| 7 | Last Memo | `last_memo_at` |
| 8 | Last Touchpoint | `last_touchpoint_at` (default sort, most recent first) |
| — | **Jump to** (Events · Meetings · Tasks icons) | links, not data — see below |

**Removed 2026-10-08 (by request, UI only):** the **Fbk** (Feedback Report) and **Memo** team columns and **Last Targeting** are out of the default view, and the **Active** (Active / Inactive) and **Client Status** (Current / Past) dropdowns are gone from the toolbar (`ACCOUNT_DEFAULT_COLUMNS` in `lib/accounts/spec.ts`, `QUICK_FILTERS` in `accounts-view.tsx`, `ACCOUNT_QUICK_FILTER_KEYS` in `lib/accounts/filters.ts` — an old `?state=` / `?client_status=` link is now ignored). The data and view columns are untouched; the three columns are still in the column picker for saved views. The list still opens on the built-in **Active clients** view (the default); **All clients** is the way to see inactive clients.

**Toolbar — one line (2026-10-08).** From a ~1360px-wide window up, the whole control row fits on one line: the compact **view** dropdown with the **Save as…** / **Save as System** icons, the seven quick filters (**Sector · Industry · Region · Market Cap · Account Mgr · Secondary · Associate** — evenly sized, each can shrink to 84px), the client count, a fixed-width **keyword search**, and icon-only actions: **Edit columns** (with its column count), **Edit filters** (with its active-filter count) and a green **Export to Excel** spreadsheet icon (a spinner while exporting). Every action keeps its tooltip, aria-label and exact behaviour. Below 1360px the row wraps and the filters take their own line. The **Feedback** and **Logistics** dropdowns were removed (an old `?feedback=` / `?logistics=` link is ignored). Built from opt-ins on the shared pieces so every other table is unchanged: `QuickFilterBar` `row` (`components/table-views/quick-filters.tsx`) and `ViewSwitcher` `compact` (`components/table-views/view-switcher.tsx`). The Columns / Filters / Export icons are now the shared `TableToolbarActions` (`components/table-views/toolbar-actions.tsx`), used by every CRM table.

**Also removed 2026-10-08:** the **Status** column (the default view is Active clients only, so it read "Active" on every row; still in the picker) and the descriptive paragraph under the page title.

**Jump to (2026-10-08).** After Last Activity, every row has three small icons (tooltips name the client) that open the matching CRM table **filtered to that client on its broadest built-in view**, so the client is the only filter and the page can't fall back to its own default:

| Icon | Opens | Link |
|---|---|---|
| Calendar | **Events** — all of the client's events, every stage, all time (built-in *All events*, not *Current & upcoming*) | `/events?view=builtin:all&client=<account_id>` |
| Handshake | **Meetings** — the *All meetings* view, no date filter (not *Upcoming*) | `/meetings?view=builtin:all&client=<account_id>` |
| Check-square | **Tasks** — all of the client's tasks, every status, all time (built-in *All tasks*, not *Open*) | `/tasks?view=builtin:all&client=<account_id>` |

Same link shape as Client Detail's "View all meetings →". `view=` selects the built-in "All …" view (`BUILTIN_PREFIX + "all"`, no filters); `client=` is each page's own client quick filter on `client_account_id`. Each page re-checks access server-side (all three are super-user only, like this page). Code: `JumpLinks` in `app/accounts/accounts-view.tsx`.

The columns are grouped under header bands: **Client · Account Team · Profile · Last Activity · Jump to**. Every column sorts when you click its header. **Ticker and Client Name stay pinned** when you scroll sideways. This is the leading "Client" band (at most two columns), using the same sticky-left technique as Portfolio.

**Account Team columns.** Each row takes its team from the source of truth for that client (see the next section): `account_team_members` for dashboard-created clients, the Dynamics lookups for Dynamics clients. The role set and order are that table's own: `ACCOUNT_TEAM_ROLE_KEYS` in `lib/account-teams/roles.ts`, mirrored by its CHECK constraint. The six roles are **Account Manager · Secondary · Feedback · Associate · Memo · Logistics**. The catalog generates one column per key (`TEAM_COLUMNS` in `lib/accounts/spec.ts`), so no role is hard-coded on the page.
- **No "Planning" role exists** in either team source.
- **Targeting** isn't a role in `account_team_members`. The Dynamics Targeting lookup is still available in the picker.
- **Each cell** shows compact initials circles (role colours, same initials directory as everywhere else), with the full name on hover. **"—"** means nobody is assigned.
- **Abbreviated headers** (2026-10-02) keep the row narrow: **Pri** (Account Manager / primary) · **Sec** (Secondary) · **Fbk** (Feedback) · **Assoc** (Associate) · **Memo** · **Log** (Logistics). The full role name is in the header tooltip, the sort button's `aria-label`, the column picker and the Excel header. A future role with no fixed abbreviation gets the first four letters of its label (`teamHeaderAbbr` in `lib/accounts/spec.ts`). The team columns are 60px wide with tighter header padding. They stay individually sortable under the **Account Team** band.
- **Multi-person roles:** the table allows several people per role, though no row has more than one today. If it happens, the view joins the names with a **line break** (A→Z), never a comma, and the cell shows one circle per person. See the format rule below.
- **Sorting and the Excel export** use the full names.
- **Switching to full names:** set `ACCOUNT_TEAM_CELL_DISPLAY` in `lib/accounts/spec.ts` to `"names"`.
- **Adding a role** takes three steps: widen the table's CHECK, add one `string_agg` line to the view, and add the key to `ACCOUNT_TEAM_ROLE_KEYS`.
- **The Dynamics lookups** (`sales_lead_primary_name` …) move to their own picker band, **CRM Team Fields**. The five team **dropdown filters** still match on those Dynamics names.

### Account team: the source of truth (2026-10-02b)

**Patch:** `sql/patches/2026-10-02b_account_team_dashboard_clients.sql` **(run in Supabase)**.

**The bug it fixed.** A team set on a dashboard-created client (on Admin → Account Teams) was saved to `account_team_members` but showed almost nowhere.
- **Why:** every reader except the Clients-list role columns reads the team from the account row's own lookups (`accounts.sales_lead_primary_id/_name`, `secondary_manager_*`, `associate_*`, `feedback_report_*`, `teaser_*`, `logistics_coordinator_*`). That covers the Clients avatar cluster, record drawer and team filters, plus Portfolio, Client Detail, Profiles, Events and row scoping.
- **The gap:** the Dynamics sync fills those lookups for Dynamics clients. Nothing filled them for dashboard clients.
- **Not the cause:** the client create/edit form has no team control by design. The team is set on Admin → Account Teams.

**The rule: one source of truth per origin**, the same ownership fence as every other dashboard write ([22](22-cutover-ownership-boundary.md)):

| Client origin | Canonical account team | How every page sees it |
|---|---|---|
| `dashboard` | **`account_team_members`**, edited on Admin → Account Teams | The trigger `account_team_members_project` → `project_account_team()` copies each role onto the client's own lookups on every insert, update or delete. The lookups are a **derived projection** that nothing else writes. |
| `dynamics` | **The Dynamics lookups** (synced), until cutover | Unchanged. Their `account_team_members` rows are a 2026-09-15 seed copy that has since drifted (20 slots differ, 29 missing on 2026-10-02), so they're shown only on Admin → Account Teams. Dynamics data is never altered. |

**Role to lookup map:** account_manager → `sales_lead_primary_*` · secondary_manager → `secondary_manager_*` · feedback_report → `feedback_report_*` · associate → `associate_*` · memo → `teaser_*` · logistics → `logistics_coordinator_*`. This is the same map the seed and `lib/access/account-team-policy.ts` use.

**Format rule for team fields (2026-10-02c). Names may contain commas.** Two users have a comma in their display name today: **"Scott Grossman, CFA"** and **"# Lewis, Tyler"**.
- **The client’s own team fields** (`accounts.sales_lead_primary_name` …) are **single-person** fields: one lookup id plus that person’s full name, commas included. That’s how the Dynamics sync writes them and how the 2026-10-02b trigger writes them. **Never split them.**
- **The Clients-list `team_*` columns** are the only place a field can hold several people. They’re joined with a **line feed (`chr(10)`)**, never `", "`, and each name has any CR/LF replaced by a space first, so every token is delimiter-free. The renderer splits only on that character (`TEAM_NAME_SEPARATOR`, `lib/accounts/spec.ts`). Patch: `sql/patches/2026-10-02c_account_team_name_delimiter.sql`.
- **The bug this fixed:** both ends used `", "`, so Scott’s name drew as two bubbles in the Pri column ("Scott Grossman" + "CFA"). The stored data was correct throughout; no data was changed.

**Clients list role columns.** The view's `team_*` columns follow the same rule per row: `account_team_members` for dashboard clients, showing every assignee, and the live Dynamics lookup for Dynamics clients. A role with several people projects only its first person (A→Z) onto the single lookup; the list column shows all of them.

**Side effect (deliberate).** Row scoping reads these lookups. A person made, say, Account Manager of a dashboard client now gets that client on their scoped pages, which is the rule Dynamics clients already follow.

**Last Activity.** These dates are computed in the view as the most recent date across **both** origins (Dynamics-synced **and** dashboard-created rows, with no `origin` filter), so a dashboard-created task or touchpoint moves the date straight away. `is_test` rows aren't excluded, matching the other CRM pages, where test data is contained by the ZVZZT client.

| Column | Rule | Matches the CRM's own rollup on |
|--------|------|------|
| Last Memo | `max(tasks.actual_end)`, sub-type **Marketing Memo**, not cancelled, linked by `bcs_account_id` | 134 / 145 clients (vs `last_teaser_date`) |
| Last Targeting | the same rule, sub-type **Targeting** | 104 / 111 (vs `last_targeting_date`) |
| Last Touchpoint | `max(touchpoints.scheduled_start)` up to now, by `client_account_id` | 135 / 141 (vs `last_touchpoint_date`) |

Most mismatches are cases where our date is **newer** than the CRM's rollup. **Memo means the Marketing Memo task, not client notes**: the latest client note matches the CRM's memo date on only 1 of 107 clients. The Dynamics rollup columns (Last Touch / Last Targeting / Last Teaser, in the Engagement band) are unchanged and still in the picker.

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

---

## Create & edit: Clients is a live dashboard-authored entity (2026-09-23)

**Add New Client** creates a dashboard-origin account (a top-level client with no parent), and the drawer's **Edit** button edits it. Edit appears on dashboard-created clients only; Dynamics clients stay read-only until cutover, and the server refuses to update any `origin='dynamics'` row. Both use one form that covers the client's own fields, grouped like the drawer:

- **Overview:** name, ticker, **Active/Inactive**, client status, sector, industry, HQ country, market cap, exchange, website, email, Ipreo ticker, master company record.
- **Primary address:** street, city, state/province, postal code, country, and **phone**.
- **Links:** primary contact (one of this client's contacts) and current event (one of its events). Both can only be set once the client exists.
- **Engagement dates** entered by hand: original start, onboarding call, teach-in, teach-in date, last data upload, SH report received.
- **Flags:** the 12 existing Yes/No flags.
- **Profile & Preferences** (new): secondary exchange, HQ state, reporting frequency, dividend yield, meeting slot, meeting platform, time zone, and four flags (Estimates, Include Admin, Exclude from Distribution, Contact IR Only).
- **Notes:** additional notes, targeting parameters, onboarding notes, peers, dietary restrictions.
- **System:** owner.

Dropdowns list the distinct values already on accounts, since option-set metadata, countries and master records aren't synced. Every save is audited (create snapshot, or before → after diff on edit). There's a Test record toggle, on by default, and a **Delete test clients** purge. Delete a test client's dashboard meetings, notes and touches first, because their foreign key to `accounts` blocks the delete.

**Display-only by design:**
- **Dynamics rollups:** last/next touch, last/next/ongoing event, days since review, last targeting/teaser, current project.
- **Derived:** region, market-cap band, and Status (Dynamics), which follows Active/Inactive.

**Deferred: the account team.** Account Manager, Secondary, Associate, Feedback, Logistics, Targeting and Teaser are **not** set by this form. They stay display-only while the account-team source of truth (the CRM's staff fields vs `account_team_members`) is decided. One consequence: **a dashboard client is visible only to users whose access isn't scoped by client**, because client-level data scoping (`lib/access/data-scope.ts`) matches on those team fields.

### Behaviour-driving field: Active/Inactive
`state_label = 'Active'` (statecode 0) decides whether a client appears on **Portfolio** (`v_client_portfolio`) and in `v_client_statistics`, the stats by market cap / region, `v_client_onboarding`, `v_contract_management`, `v_productivity_detail_summary`, `v_client_detail_summary` and `v_client_quarterly_pnl`. It's the Active/Inactive field on the form, and saving sets both the statecode and statuscode pairs. Client Status (Current / Past) gates nothing.

### Newly flattened columns (`sql/patches/2026-09-23g_accounts_full_fields.sql`)
| Column(s) | Dynamics field | Populated (of 228) |
|---|---|---|
| `address1_line1 / _city / _state / _postal_code / _country` | `address1_*` (the PRIMARY address) | 34 / 159 / 8 / 21 / 11 |
| `address2_line1 / _postal_code / _county` | `address2_*` | 119 / 89 / 88 |
| `phone` | `telephone1` | 10 |
| `secondary_exchange_code / _label` | `bcs_secondaryexchange` | 23 |
| `hq_state_code / _label` | `bcs_state` | 61 |
| `reporting_frequency_code / _label` | `bcs_frequency` | 45 |
| `timezone_code` | `bcs_timezone` (Dynamics time-zone index) | 38 |
| `meeting_slot_minutes` | `bcs_mtgslots` | 34 |
| `meeting_platform_pref` | `bcs_mtgplatformpref` | 36 |
| `div_yield` | `bcs_divyield` | 157 |
| `targeting_parameters` | `bcs_targetingparameters` | 30 |
| `additional_notes` | `crdfa_additionalnotes` | 55 |
| `estimates`, `include_admin`, `exclude_from_distribution`, `contact_ir_only` | `bcs_estimates`, `bcs_includeadmin`, `bcs_excludefromdistribution`, `new_contactironly` | 108 / 85 / 76 / 105 |

**The address fix.** The mapper used to read only `address2_*`, and `address2`'s country is typed into its **county** field, so the old `country` column was empty on every client. `v_admin_accounts_all` now shows the **primary (`address1`) address**, falling back to `address2` (and `address2_county` for country) for each of city, state/province, country, and the new street and postal code. The client form edits the `address1` block.

**Deliberately not flattened:**
- **The staff/team cluster** (`bcs_acctmgr`, `bcs_feedback`, `bcs_assoc`, `bcs_log`, `bcs_tser`, `bcs_targt`, `bcs_secmgr`, `bcs_internalassignment`, the feedback team, the editorial queue): deferred with the account team.
- **Rollups** (open/last client tasks, last activity and appointment, last SG touch, `bcs_length`).
- **Dynamics system constants** (do-not-contact defaults, currency, territory, and so on).
- **Sparse or unclear fields:** `_bcs_industry_value` (9), `bcs_listingtype` (1), `new_do`.

`v_live_outreach` also now reads `div_yield` from the column, with `_raw` as a fallback. The sync (`mapAccount`) writes every new column, so **run the patch before the code deploys** (and after 23f).
