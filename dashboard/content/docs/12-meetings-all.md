# 12 — Meetings (all CRM)

> **Status: built.** The page is at `/meetings`, reached from the **CRM** entry pinned to the **bottom of the main nav rail** (super-user-only — see [Where it lives in the nav](#where-it-lives-in-the-nav)). Patches to run in Supabase, in this order:
>
> 1. `sql/patches/2026-09-09_admin_meetings_all.sql` — **required**; the page will not load without it.
> 2. `sql/patches/2026-09-09_admin_meetings_view_columns.sql` — adds `client_ticker` **and** the 18 extra catalog columns. **Supersedes** `2026-09-09_admin_meetings_ticker.sql`; run this one instead if you have not already run that. Safe `CREATE OR REPLACE`, no `CASCADE`.
> 3. `sql/patches/2026-09-09_meeting_saved_views.sql` — the `meeting_saved_views` table behind [Saved views](#saved-views). Until it is run, the switcher shows only the five built-ins and saving is unavailable.
> 4. `sql/patches/2026-09-10_meetings_perf.sql` — **supersedes** `2026-09-10_admin_meetings_filter_options.sql` (run this instead of, or after, that one). Creates `v_admin_meetings_filter_options`, points the view's `feedback_name` at the flattened column, indexes it, and exposes `host_id` so the Host filter can use `idx_meetings_host`. **Optional but worth it** — see [Performance](#performance) for what each part is worth in milliseconds. Without it everything still works, just slower.
>
> The page loads in every one of those states: it asks the database which columns it actually has (`availableColumns`) and drops anything absent from the select list and the filters, rather than erroring. Un-runnable columns show as disabled in the column picker with the reason.

## What it is

Every meeting in the CRM, in one table, with nothing hidden. It reproduces the Dynamics **"Investor Meetings (All)"** view so an admin can answer "what does the CRM actually hold?" without opening Dynamics.

Deliberately **unfiltered** — this is the whole point of the page:

- **Every status.** Confirmed, Pending, Cancelled, and anything else `meeting_status_label` carries. Not Confirmed-only, unlike almost every other view in the app.
- **Every date.** Past and future, no recency floor, no Eastern-day cutoff.
- **Active *and* deactivated records.** `state_label = 'Inactive'` rows are included. This is a judgement call, not a law — see [Deactivated records](#deactivated-records) below.
- **No row scoping.** `resolveMeetingScope` is not applied. Every client's meetings are returned to whoever loads the page.

## Security

**This page is the one place in the app that reads meetings without scoping them**, and it does so through the service-role client, which bypasses RLS. A successful load hands the caller the firm's entire meeting history. Three independent gates stand in front of it:

1. **The route is in `ADMIN_ONLY_ROUTES`** (`lib/access-control.ts`). `canAccessRoute` checks that list *after* the `super_user` backstop and *before* the Roles-matrix lookup, so `/meetings` is super-user-only and **cannot be opened to another role from Admin → Roles**. Ticking its boxes there does nothing. This is what makes it different from the other hidden pages, which are super-user-only only because Admin is.
2. **`proxy.ts` enforces that before the page renders**, so typing the URL directly is blocked too.
3. **The page re-checks the role itself** (`app/meetings/page.tsx`) and redirects to `/no-access` before constructing the Supabase query. The data fetch is written *below* the guard on purpose — if you add a read to that file, put it below the guard as well.

The check uses the **effective** role, so a super-user using **View as** previews the denial exactly as the impersonated person would experience it, rather than quietly keeping their own access.

`v_admin_meetings_all` should not be referenced from any row-scoped page.

## Where it lives in the nav

Meetings sits at the **bottom of the main nav rail**, below every reporting section, behind a thin **"CRM"** section break. It used to be an Admin → Hidden Pages link; it is not one any more, and it is not listed in both places.

The treatment is deliberately different from the reporting items: a **teal outline** (1.5px `#1FB6A5`, transparent fill) with the icon and label tinted to match, instead of the navy gradient fill the other rail items take when active. Outlined rather than filled is the point — this is a different *kind* of destination (the raw CRM mirror, unscoped), not a more important one. Even when it is the current page it stays outlined, deepening to the faintest teal wash rather than filling.

In the collapsed rail the icon box also carries its **name inside it** — a 6px "Meetings" under the glyph. **No other rail icon does**; the rest rely on the hover fly-out alone. It is an exception on purpose, for the one entry that is not part of the reporting nav. Inside a 40px box the glyph drops to 14px and the caption sits on a 7px line under it (`leading-none` matters — the default line-height on 6px text pushes the caption into the border); measured, the word is 32px wide in a 40px box. The caption is `aria-hidden`, because the link already carries the same word as its `aria-label` and a screen reader should hear it once.

It renders in all three nav surfaces — the collapsed 58px rail (icon plus a three-letter "CRM" caption, with the usual hover fly-out label), the expanded sidebar, and the mobile sheet. `margin-top: auto` is what pins it to the bottom, which is why both `<nav>` elements are flex columns.

**Gating is unchanged and is the important part.** `/meetings` is still in `ADMIN_ONLY_ROUTES` — super-user-only, not delegable through the Roles matrix. Whether the *entry* is drawn is `canSeeCrmNav`, which requires both `role === "super_user"` and `canAccessRoute`. For a non-super-user the entire block is absent from the DOM: **no item and no divider**, rather than an empty labelled section. The role is the effective one, so **View as** removes it too. See [01 — Access & users](01-access-and-users.md#the-crm-block-in-the-nav-rail); asserted in `lib/nav-crm.test.ts`.

## Columns

**The table's columns are whatever the active saved view says** — chosen and ordered in [Edit columns](#edit-columns), from a catalog of every meeting-level field. What follows is the **default layout**: the fourteen CRM columns in the order the Dynamics "Investor Meetings (All)" view shows them, which is what every built-in view uses and what the page looks like until someone changes it.

Every column is sortable, and the sort is part of the view. The default is **Date descending**, as in Dynamics. Columns are banded under group headers — Meeting, Client, Counterparty, Representatives, Workflow — see [Column groups](#column-groups). Several are **condensed on screen** — a ticker, a pill, an icon — with the real value on hover and in the export; see [Condensed columns](#condensed-columns).

| # | Column | Source | Notes |
|---|--------|--------|-------|
| 1 | Meeting Type | `meetings.meeting_type_label` | Header **"Type"**; shows the **full word** — Live / Virtual |
| 2 | Meeting Status | `meetings.meeting_status_label` | Header **"Status"**; shows the **full status** in a coloured pill |
| 3 | Date | `meetings.meeting_date` | Stored UTC, rendered **Eastern**, compact single line: `11/18/26 11:30 AM` |
| 4 | Client | `meetings.client_account_name` + `accounts.ticker_symbol` | Shows the **ticker symbol**, full name on hover. Still **links** to `/client-detail?account_id=…` |
| 5 | Event | `events.name` | **Joined** — `meetings` carries `event_id` but no event name |
| 6 | Institution | `meetings.institution_name` | |
| 7 | Investor | `meetings.investor_text` | Free text; may name several people. Shown as a **full name** — see below |
| 8 | Host | `meetings.host_name` **+ `_raw`** | A meeting can have more than one host; the view concatenates the flattened host with a second one from `_raw` when present. Shown as **initials** |
| 9 | Feedback | **`_raw`** → `_bcs_feedback_value` formatted value | The feedback assignee. Same expression `v_feedback_outstanding` uses. Shown as **initials** |
| 10 | Booked By | `meetings.booker_name` | Shown as **initials** |
| 11 | On Behalf Of | **`_raw`** | Rose custom lookup first, falling back to the Dataverse `createdonbehalfby`. Header **"OBO"**; shown as **initials** |
| 12 | Calendar | `meetings.calendar_label` | Narrowed — truncates with the full value on hover |
| 13 | FB in BDA | `meetings.feedback_bda_label` | Header **"BDA"**; shown as a **three-state icon** |
| 14 | FB Rec'd | **`_raw`** | Rendered as text — Dynamics may model this as a Yes/No flag *or* a date, and the view passes the formatted value straight through. Header **"Rec'd"**; shown as a **check when populated** |

### Column display

Four display conventions, all screen-only — the underlying data, the row set, filtering and access gating are untouched by them. They travel with their columns: a column moved or hidden in [Edit columns](#edit-columns) keeps (or takes with it) the rendering described here.

- **Staff columns render the standard initial-circle avatars.** Host, Feedback, Booked By and On Behalf Of use the shared `AccountTeamAvatars` component (`components/account-team-avatars.tsx`) — the same 24px overlapping circles as the Portfolio, Profiles and Onboarding account-team clusters, so a circle here is the same object as a circle there. Each carries its own `Role: Full Name` tooltip.

  Initials come from that component's own logic — `lookupInitials` against the global account-team directory, including the three-letter `KMu`/`KMi` disambiguation when two people's initials collide. None of it is reimplemented here; this page only splits a multi-person cell and picks the colour.

  A cell can hold more than one person (Host, mainly, where the view concatenates hosts with `", "`) — each becomes its own circle in the cluster.

  Colours are one hue per **column**, drawn from the same navy→teal ramp as `ACCOUNT_TEAM_ROLES` in `app/portfolio/portfolio-table.tsx`: Host navy, Feedback blue, Booked By teal, On Behalf Of light teal (dark text, as on Portfolio). One hue per column rather than per person is what keeps the four readable once the names are gone.

  These columns' width floor is the **header text**, not the circles — two overlapping circles need only 40px.
- **Investor stays a full name**, deliberately: it is the row's primary *external* identifier, not internal staff.
- **Client shows the ticker symbol**, with the full account name on hover — see [Condensed columns](#condensed-columns). It still links to `/client-detail?account_id=…`, the same destination the Portfolio, To-Do and Onboarding tables use, and a row with no account id renders plain text rather than a dead link.
- **Date is one compact line** — `11/18/26 11:30 AM`, Eastern. The `MM/dd/yy` shape matches the other tables (see `DATE_FMT` in `app/feedback-manager/feedback-manager-view.tsx`).

Two things the abbreviations deliberately do **not** change:

- **Sorting and the keyword filter still work on the full underlying values.** Sorting the Date column orders by the raw timestamp, not the formatted string; typing `Mavroidis` still finds a row whose Host cell shows only an `NM` circle.
- **The Excel export keeps full values** — full names, full status and type **words**, the real FB values, a real date-time cell formatted `yyyy-mm-dd hh:mm`, and the client as plain text. It gained a **Ticker** column beside Client rather than replacing the name. Initials, letters, dots and icons are a screen convenience, not the data.


### Column groups

Above the column headers sits a band per group. Five over the default layout:

| Group | Columns (default layout) |
|-------|--------------------------|
| **Meeting** | Type, Status, Date |
| **Client** | Client, Event |
| **Counterparty** | Institution, Investor |
| **Representatives** | Host, Feedback, Booked By, OBO |
| **Workflow** | Calendar, BDA, Rec'd |

The full catalog assigns every column to one of seven groups — the five above plus **Logistics · Live meetings** and **System**, which only appear once a view selects columns from them:

| Group | Every column in it |
|-------|--------------------|
| **Meeting** | Date & Time, Meeting Type, Status, City, State / Region, Group Meeting, Hosted in HQ, General Notes, State (active/inactive) |
| **Client** | Client, Event, Ticker (raw) |
| **Counterparty** | Investor, Institution |
| **Representatives** | Booked By, On Behalf Of, Host, Feedback, Client Booked, Host Notes |
| **Workflow** | Calendar, Profile, FB in BDA, FB Rec'd, Feedback Notes |
| **Logistics · Live meetings** | Sent, Confirm, Driver, Food Order, Logistics Notes |
| **System** | Modified By, Modified On, Created By, Created On |

**These are the table's groups, not the drawer's sections.** Labels, types and ordering still come from `MEETING_SECTIONS` — that is still one list, not two — but the grouping is the table's own, because the two surfaces answer different questions. The drawer reads top to bottom as one record, so its "Overview" holding the meeting, the client and the counterparty together is fine there; the table is scanned across, so those three want to be separate bands. Concretely the drawer's **Overview** splits three ways here (meeting-level facts → Meeting, the client → Client, institution and investor → Counterparty), and its **Planning** and **Feedback** merge into one **Workflow**. `COLUMN_GROUPS` in `lib/meetings/columns.ts` is the vocabulary, and every catalog entry names one.

**Bands are contiguous; picker headings are not.** A band spans adjacent columns, so a group split across the row genuinely *is* two bands — `bandsFor` groups consecutive runs of the active view's columns and the spans follow whatever order the view puts them in. The picker is a list, so `catalogBySection` groups globally and shows each group exactly once; without that, the drawer's field order (Investor sits between Status and Client) would print "Meeting" and "Counterparty" twice each.

### Condensed columns

The default layout carries 14 columns plus the open-record button, and the widest of them were the ones saying the least. Six were tightened so the whole table fits a normal desktop without horizontal scrolling: **1552px wide, down from ~1919px** (the table's `min-width` is computed from the active view's own column widths — pin it and the browser spreads the slack instead, so the narrowing stops matching what renders).

**Type and Status keep their words.** They were briefly a single letter and a bare dot; that went too far. A letter you have to decode is not a saving when the full word costs 62px, and a status is the column people scan hardest. Both are back to full text — the colour on Status stays, because that is the part doing the work.

| Column | Was | Now | Rendering |
|--------|-----|-----|-----------|
| Client | 200px | 92px | **Ticker symbol** (`baseTicker`, so `NVCR-US` → `NVCR` while `BRK.B` keeps its class dot), linked, full account name on hover |
| Meeting Type → **Type** | 110px | 62px | **Full word** — Live / Virtual |
| Meeting Status → **Status** | 125px | 90px | **Full status** in a coloured pill |
| On Behalf Of → **OBO** | 96px | 60px | Unchanged initials circle; only the header shrank |
| Calendar | 150px | 96px | Truncates with ellipsis |
| FB in BDA → **BDA** | 110px | 62px | Three-state icon |
| FB Rec'd → **Rec'd** | 110px | 66px | Check when the CRM holds a value |

Every one of them carries the full value in the cell `title`, so hovering any mark gives the real text. The short headers keep the full wording in their own tooltip.

**Widths are a floor, not a cap.** The table is auto-layout, so a column can never render narrower than its header text *or* its widest cell — which is why the compact columns needed short labels too. Measured against the app's Geist face: the "Type" header needs 59px and a "Virtual" cell 55px (hence 62px); the widest status pill, "Confirmed", needs 86px (hence 90px); "OBO" needs 59px; "Booked By" needs 93px, having been declared at 88px and never actually honoured, so it is now declared at its real 94px.

**Status pill colours** come from `statusPill` in `app/meetings/meeting-record-pane.tsx`, exported so the pill on a row and the pill inside that row's drawer cannot drift apart: Confirmed green, Cancelled red, Pending amber, anything else (e.g. `TBR`) neutral grey. Roughly 96% of live rows are Confirmed, so the tint's real job is making the other 4% jump out of a long scroll — which is why the colour survived when the dot did not.

**Only the two FB columns are symbols.** They are the ones where a mark genuinely beats a word: the value is a workflow state that is either there or not, the words are long ("Closed - No Feedback"), and the column is scanned for exceptions rather than read. Everything else on the row carries its text.

**FB in BDA is not a yes/no**, which is why it gets three states rather than a checkbox — the field carries `Closed - All in`, `Closed - No Feedback` and `Awaiting Additional`, and collapsing the first two together would erase the distinction the column exists to show:

| Value | Mark |
|-------|------|
| `Closed - All in` | green check |
| `Closed - No Feedback` | grey slashed circle |
| `Awaiting Additional` | amber clock |
| anything unrecognised | falls back to the raw text, not an invented icon |

**FB Rec'd is empty on every live row sampled** (`fb_received` was NULL across 5,000 rows on 2026-09-09), so expect a column of em dashes until the CRM starts populating it. The check only means "the CRM holds something here" — the field is a flag *or* a date depending on how Dynamics models it, and the value itself is on the hover.

**Sorting and search still use the full name for Client**, not the ticker: the ticker is nullable (and entirely NULL until the patch below is run), and sorting a mostly-empty column would look broken. The ticker *is* added to the keyword haystack, so typing what you see on screen finds the row.


### Columns sourced from `_raw`

Four of the fourteen are not flattened columns on `public.meetings` and are read out of the `_raw` jsonb blob the sync stores. Reading a key that does not exist yields `NULL` rather than an error, so an unconfirmed key name degrades to an empty column instead of breaking the page.

`feedback_name` uses a key already proven in production (`v_feedback_outstanding` depends on it). **`on_behalf_of`, `fb_received`, and the second host in `host_names` use key names that have not been confirmed against live data.** If those columns render empty, run the discovery query in the patch header:

```sql
SELECT jsonb_object_keys(_raw) AS k
FROM public.meetings
WHERE _raw IS NOT NULL
ORDER BY 1;
```

Then correct the `COALESCE` lists in both `sql/03_views.sql` and the patch.

### Deactivated records

`state_label` is exposed as a column on the view and included in the Excel export, but is **not** one of the 14 on-screen columns. Deactivated rows are included by default, to honour "show all of them". If they turn out to be noise, the fix is a one-line `WHERE m.state_label = 'Active'` in the view — the column is there so the decision is visible and reversible.

## Behaviour

### Saved views

The View control is a **saved-view switcher**. It lists two scopes, grouped and labelled, each option showing its row count:

- **System views** — shared, visible to everyone who can open the page. Includes the five **built-ins** below plus any a super-user has saved.
- **My views** — private to the signed-in user. Nobody else can see them, or even fetch them (see [Security](#security-model-for-saved-views)).

A view's config is `{ columns: ordered column keys, filters: [...], sort: { field, dir } }`, stored as jsonb.

#### The five built-ins

The presets the dropdown carried before saved views existed are now **built-in system views**: Upcoming (today or later), Happening today, Pending status, Upcoming-no-host, All meetings.

They are **code, not rows** (`BUILTIN_VIEWS` in `lib/meetings/views.ts`), which means they always exist, need no seeding step, and cannot be edited, deleted or set as a default. That is what lets the page work the moment the table patch runs, before anyone has saved anything — and it is why the five ids are prefixed `builtin:`, so they can never collide with a uuid from the table.

Each is expressed as ordinary filter conditions, so there is now **one** filter mechanism rather than a preset path plus a filter path. "Upcoming" is `meeting_date is on or after $today`; "Upcoming, no host" is that plus `Host is empty`. The `$today` token is substituted with the Eastern calendar day **at request time**, which is what keeps a saved view rolling rather than frozen to the day it was saved.

**Caveat on Pending.** The exact stored label could not be confirmed: only `'Confirmed'` and `'Cancelled'` appear anywhere in this repo. The predicate therefore matches the *prefix* "pending" case-insensitively, so `Pending`, `pending` and `Pending Confirmation` all qualify. **The count in the dropdown is the diagnostic** — a "Pending status (0)" means the real label shares no prefix with "pending", and the fix is the built-in's own condition (`Status starts with "pending"`) in `BUILTIN_VIEWS`. Note `starts with` does not tolerate a leading space the old browser-side `.trim()` did. To settle it:

```sql
SELECT meeting_status_label, count(*)
FROM public.meetings
GROUP BY 1 ORDER BY 2 DESC;
```

**"No host" reads the host NAME, not `host_id`** — the view exposes `host_names`, not the id. The name is the Dynamics formatted value of the same lookup so the two agree in practice, but a meeting whose `host_id` failed to resolve to a name would read as unassigned. Expose `host_id` on the view if that ever needs to be exact.

#### Which view opens

In order, first match wins:

1. an explicit `?view=<id>` — what the switcher itself navigates to;
2. the caller's **personal default**;
3. the **system default**;
4. the built-in **Upcoming (today or later)**.

A `?view=` naming something the caller cannot see — another user's personal view, or a deleted one — falls through the same chain rather than erroring. An unreachable id is a stale bookmark, not an attack worth a 500.

#### Saving

| Control | What it does |
|---------|--------------|
| **Save** | Overwrites the active view's config. Only offered for a view the caller may edit, and only when there are unsaved changes. |
| **Save as…** | Creates a new **personal** view, prompting for a name. |
| **Save as System** | Creates a shared **system** view. Super-user only. |
| **Set default** | Makes the active view the caller's personal default (or, for a system view, the system default). |
| **Manage…** | Lists the caller's personal views — and, for a super-user, the non-built-in system views — for deletion. |

An **edited** marker appears beside the switcher whenever the working config differs from the saved one, because at that moment the row count on screen no longer matches the count in the view's own label.

**Unsaved edits live in the URL.** Column, filter and sort changes have to reach the server — filters are applied in the query, so "Apply" cannot be local state. Rather than persisting a draft row, the working config rides in `?cfg=` as plain JSON, validated by `parseConfig` on arrival. That keeps one server-side filter path, makes an in-progress view shareable as a link, and leaves the saved row untouched until someone presses Save. When an edit exactly undoes back to the saved config, the `?cfg=` is dropped again.

#### Security model for saved views

This is the app's **first write path**, and it is worth understanding why the checks live where they do.

There are **two doors into the table**, and they are protected differently.

The *direct* door — a PostgREST request using `NEXT_PUBLIC_SUPABASE_ANON_KEY`, which ships in the browser bundle — is shut by the database: RLS is enabled with **zero policies**, the same pattern `user_roles` and `cron_send_log` use. (The anon role also has no GRANT on this schema, so RLS is belt *and* braces here rather than the only lock; it is what keeps the table shut if a future GRANT or dashboard toggle ever opens that path.)

The *app's* door is not protected by any of that. Every dashboard read and write goes through the **service-role key**, which bypasses RLS entirely — so for the path that is actually used, authorisation lives in application code, in one file: **`app/meetings/views-actions.ts`**. A missing check there is a real hole that no database policy will catch. Its invariants:

1. **Identity is resolved server-side, never passed in.** No action accepts an owner id, user id or email. The caller comes from `getEffectiveIdentity()` and nothing else, so a hand-crafted request cannot claim to be someone else. The id is folded to its **canonical** form (mirroring `public.canonical_user_id`), so a person with duplicate Dynamics systemuser records has one set of views rather than one per alias, and it is validated as a uuid before it is ever interpolated into a PostgREST expression.
2. **Personal views are private.** The list query filters on `owner_user_id = <caller>`, so nobody else's row is ever *fetched* — it cannot leak through a later logging or serialisation mistake. Updates and deletes carry the same predicate **in their own WHERE clause**, not just in a prior SELECT, so a concurrent ownership change cannot be raced: the write matches zero rows and fails loud.
3. **System views are super-user write.** Readable by anyone who can open the page; created, edited, defaulted and deleted only by an effective `super_user`.
4. **Impersonation is read-only.** A super-user in **View as** mode *reads* the impersonated person's views — that is what the preview is for — but every mutation is refused. One person's private views can never be edited by another account. The toolbar hides the save controls and says so rather than offering a doomed click.
5. **Configs are validated, not trusted.** Everything inbound goes through `parseConfig`, which admits only known column keys and a closed operator set — so the stored jsonb is always something the query builder can turn into a safe query.

The database carries the same invariants as a **third layer**: CHECK constraints pairing `scope` with `owner_user_id`, and partial unique indexes for *at most one personal default per user* and *at most one system default*. If a bug in the action layer would write two defaults, the write fails rather than leaving state the resolver has to guess about.

The page's own gates are unchanged and still come first — `/meetings` is in `ADMIN_ONLY_ROUTES`, and the actions re-check the effective role rather than assuming the page gated them, because a server action is its own entry point.

**Scope note:** this table holds display preferences only. Nothing in it can change a meeting — the CRM mirror stays read-only.

### Edit columns

A panel (top right) for choosing which columns the table shows and in what order: checkboxes on the left grouped by section, the chosen columns on the right in render order.

**The catalog is the record drawer's own field list.** `lib/meetings/columns.ts` *derives* it from `MEETING_SECTIONS` in `lib/meeting-record.ts` — the same definitions the drawer renders — so labels, types and ordering all come from one place, and adding a field to the drawer adds it to the picker automatically. What the catalog adds is what the drawer does not need: which view column backs each field, how wide it renders, how it is painted, and **which group it bands under** (see [Column groups](#column-groups) — the table groups the same fields differently from the drawer). Three list-only extras (Event, raw Ticker, State) have no drawer field and are assigned a group directly.

Reordering is HTML5 drag-and-drop, with **▲/▼ buttons as the accessible path** — not a fallback afterthought, since dragging is unavailable by keyboard.

Applying updates the working config; it becomes permanent when the view is saved.

**Columns the database does not have yet** are shown disabled, with the reason on hover. The page probes the deployed view's real column list on every request rather than trusting a flag, so the picker always tells the truth about the database it is pointed at.

### Edit filters

A condition builder (top right): one or more `field · operator · value` rows, combined with **AND**. This generalises the old preset dropdown — the built-ins are now expressed as exactly these conditions.

Operators are offered per **field type**, from the catalog: text gets is / is not / contains / starts with / is empty / is not empty; dates get is before / is on or after; toggles get is Yes / is No. Changing a row's field snaps the operator to one valid for the new type rather than leaving an impossible pair.

**Conditions apply server-side.** Nothing is filtered in the browser — Apply re-runs the query. Dates are Eastern calendar days, and the Eastern-day tests become plain `meeting_date` timestamp ranges against Eastern midnight, so the database does no per-row time-zone conversion and `idx_meetings_date` still applies.

**Nothing a user types becomes query syntax.** `field` is checked against the catalog and `op` against a closed union; values only ever arrive as the *argument* to a builder method. The one place a value enters PostgREST grammar is the `contains` / `starts with` ilike pattern, which escapes `%`, `_` and `\`. Verified against real data on 2026-09-09: institution names containing dots, commas, parentheses and ampersands round-trip exactly, and a literal `%` matches nothing rather than everything.

One deliberate subtlety: **is not** is `not-equal OR null`, not a bare `neq`. A bare `neq` also excludes rows with no value, and a row with nothing recorded is not the thing being excluded. (`eq` + `is not` sum to the full row count; that is checked.)

### Client / Host / Feedback filters

Three dropdowns in the toolbar, beside the view switcher:

| Filter | Matches on | Control |
|--------|-----------|---------|
| **Client** | `client_account_id` | Typeahead — ~189 clients is too many for a plain select |
| **Host** | `host_id`, expanded across the person's alias group | Native select (~26) |
| **Feedback** | `feedback_name` (flattened + indexed) | Native select (~26) |

Each has an **All …** option, and a **Clear filters** button appears once any is set. They **AND** with each other, with the active view's own filters, and with the keyword box — and, like everything else on this page, they run **in the database**: changing one re-queries, so the row count, the table and the Excel export all see the same set.

**They are not part of the saved view.** A saved view is a shape you return to; these are ad-hoc narrowing you apply and drop. Keeping them out of `ViewConfig` means picking a host does not mark the view "edited" or offer to save "Upcoming, but only Kate's". They ride in their own URL params (`?client=`, `?host=`, `?fb=`), so they are still shareable as a link. The per-view counts in the switcher are deliberately counted **without** them — that number should say how big a view is, not how big it happens to be under your current selection; the toolbar's own count is the one that reflects the filters.

**Client matches on the account id, not the name.** Two accounts could share a display name. No live pair does today, but the id is free to use and cannot go wrong.

**Host matches an id, not a name** — see [Performance](#performance) for why, including the alias trap and the second-host limit. Before the perf patch it falls back to whole-token name matching (never a substring: filtering `"CRM"` returns **0**, not the 2,551 that the host with the full name has).

#### The choices load lazily

**The page does not wait for them.** Sourcing the option lists can take seconds — when `v_admin_meetings_filter_options` is missing the loader falls back to scanning every row, ~4.6 s — and nothing on screen needs them in order to paint a table whose rows were ready in a quarter of a second. So they are fetched by the client *after* the table renders, through the `loadMeetingFilterOptions` server action (same super-user gate as everything else here).

Measured with the view absent, i.e. the worst case: **661 ms to first paint, down from 5,604 ms**. The options arrive a few seconds later, in the background.

They are cached at module scope for the browser session, so switching views or applying a filter — both of which re-render the toolbar — does not re-run the query. Concurrent callers collapse onto one request.

Until they land the three controls are **disabled and say so** ("Host — loading…"). That is deliberate: a native `<select>` cannot be populated at the instant it opens, so the fetch runs on mount rather than on first click, and an enabled-but-empty dropdown would read as "there are no hosts". A filter arriving on the URL (`?client=…`) shows "applied" rather than a blank box, so a shared link never looks like it lost its filter.

**Do not move this back into the page loader.** It would put a multi-second query in front of a quarter-second one again.

#### Where the choices come from

`v_admin_meetings_filter_options` — one view, three `kind`s (`client` / `host` / `feedback`), each row a `value`, a `label` and a meeting count (which is what puts "Royal Gold, Inc. (355)" in the list). PostgREST has no `DISTINCT`, so the distinct-ing happens in Postgres and the app makes **one** request for a few hundred rows rather than pulling 13.6k.

Hosts are **unnested** (`string_to_array` + `unnest` on `", "`), so a co-hosted meeting contributes to both hosts' options and both their counts. Checked: the host counts sum to exactly the number of rows that have a host (12,966).

The view reads `public.meetings` directly rather than `v_admin_meetings_all`, so it does not pay for joins and jsonb extractions it never uses. Hosts are grouped by **canonical user id**, so a person with duplicate systemuser records is one option with one summed count.

Without the patch the loader **falls back** to a three-column scan of the admin view, de-duplicated server-side. Correct, and it produces the identical lists (189 / 26 / 26) — but it costs **4.6 s on every page load**, which was the single biggest thing wrong with this page. The fallback exists so the feature works the moment the code lands; the view is what makes it fast.

### Planned: related-table columns

**Not built.** Eventually a column should be able to come from a table joined 1-1 to the meeting — the account's sector, the event's stage. The structure is ready for it and the extension point is marked:

- `MeetingColumnDef.related` in `lib/meetings/columns.ts` — declare `{ table, foreignKey, column }` there instead of adding another view column.
- `lib/meetings/query.ts` is the only thing that assumes a column is a plain top-level field. It would need to emit the PostgREST embed (`accounts!inner(sector)`) and flatten the nested result; both the select builder and the filter builder already skip `related` columns rather than mis-handling them.

Everything else already tolerates it: the catalog is keyed by `key`, saved views store `key` strings, and the picker groups on `section`.

### Server-side filtering

**Only the active view's rows and columns are fetched.** `app/meetings/page.tsx` resolves the view, turns its filters into PostgREST predicates and its column list into the `select()`, and applies both to the query — so the page holds one view's rows, never all ~13.6k, and never `SELECT *`. Switching views (or applying columns/filters/sort) pushes a new URL, which re-runs the server query; the swap runs inside a `useTransition`, so the current rows stay on screen with a "Loading…" note instead of the table flashing empty.

Selecting the view's own columns is what keeps the expanded catalog free: with 18 more columns on the view — four of them long-text notes — a `SELECT *` would drag all of them into every row of every query. A 14-column layout costs what it did before the catalog grew.

Measured against the live view on 2026-09-09:

| View | Rows | Fetch |
|------|------|-------|
| **Upcoming (today or later)** — default | 332 | ~230 ms |
| **All meetings** | 13,646 | ~14 s |

The per-view counts add roughly 300 ms on top (they run together and return counts only), so the default open costs well under a second against the ~15 s it used to.

Neither `?view=` nor `?cfg=` is a security boundary. `?view=` only selects among views the caller may already see — the list query never returns anyone else's personal view, so an id naming one simply is not found and the default chain runs instead. `?cfg=` is validated by `parseConfig` and can at most widen the result back to what **All meetings** already returns to the same super-user caller. The role gates above are what actually protect the data.

**The page loads whatever SQL state the database is in.** Naming a column PostgREST does not know is a hard error, not an empty column, so one missing column would otherwise blank the page. `availableColumns` asks the view what it actually has, once per request; anything absent is dropped from the select list, its filters are skipped (which widens rather than errors), and an unavailable sort field falls back to the date.

**Keyword search still runs in the browser**, over whatever the active view *and the toolbar filters* loaded — so selecting a client first makes the keyword box cheaper still. That is cheap for every view but **All meetings**, which remains the one heavy case — unchanged from before. It searches the **visible** text columns plus the ticker, derived from the active columns rather than fixed: hiding a column also stops it matching, since a row whose only matching cell is off screen is more confusing than no match at all.

### Performance

Measured against live data (13,646 rows). The page was **5.6 s** before this pass.

| Stage | Was | Now |
|-------|-----|-----|
| Saved views · column list · alias map | sequential | run **together** (189 ms) |
| Filter options (the dominant cost) | 4.6 s **in the critical path** | **off it entirely** — fetched after render, and one small query once the patch is run |
| `availableColumns` | 159 ms **every request** | memoised per process |
| Row fetch (Upcoming) | 263 ms | unchanged — it was never the problem |
| **"All meetings"** | **14.3 s / 8.5 MB / 14 round trips** | **3.6 s, capped at 2,000 rows** |
| **Time to first paint (Upcoming, options view absent)** | **5,604 ms** | **661 ms** |

Five things changed.

**0. The filter options left the critical path.** They were the single biggest cost and the least urgent thing on the page — see [The choices load lazily](#the-choices-load-lazily). This is what took first paint from 5.6 s to 661 ms; the four changes below are what the remaining 661 ms is made of.

**1. The row cap.** `ROW_CAP = 2000` in `lib/meetings/query.ts`. The table only ever paints ~30 rows, and nobody finds a meeting by scrolling to row 9,000 — they filter. When the cap bites, the toolbar says *"Showing first 2,000 of 13,646 — refine filters to narrow. Export includes all."* rather than letting you discover it by reaching the bottom.

The **Excel export is not capped**. It re-runs the query with no ceiling through the `loadRowsForExport` server action and re-applies the keyword box, because capping the page must never start silently truncating spreadsheets. Exporting is an explicit click with a progress state, so it is allowed to take its ~14 s.

**2. `feedback_name` stopped being a `_raw` extraction.** `public.meetings.feedback_name` has been a real flattened column for a while; the view was still digging the same string out of the jsonb blob because the column did not exist when the view was written. Verified identical across 600 rows (0 differ, same 44 nulls) — a swap, not a behaviour change — and now indexed by `idx_meetings_feedback_name`.

**3. The Host filter matches `host_id`, not a name.** It used to match a name inside `host_names`, which is `concat_ws(host_name, _raw->>host2)` — an expression no index can serve (992 ms). `host_id` is a real column already covered by `idx_meetings_host`.

> **The alias trap.** Live data has **28 distinct `host_id`s but only 26 distinct host names**: Brian Smith and Blair Mutschler each carry two Dynamics systemuser records. Filtering on one `host_id` would silently return part of either person's meetings. So the dropdown's value is the **canonical** id (`public.canonical_user_id`) and the app expands it to every id in that alias group — `host_id IN (…)`, still a plain index scan. Verified: Brian Smith returns 1,042 either way, where a single-id filter would have missed 2; Blair Mutschler 388, missing 1.

> **Known limit.** A meeting's *second* host lives only in `_raw` and has no flattened column, so it is not covered by a `host_id` filter. That affects **0 rows today** — no live meeting has a second host. If co-hosting starts, flatten `bcs_host2` into a real column and add it to the `IN` list; do not go back to matching strings.

Until the patch runs, the Host filter **falls back** to the old name-token match — correct, just unindexed — because naming a column PostgREST does not know is a hard error that would blank the page rather than merely slow it.

**4. The page's independent stages run together.** Saved views, the column list, the filter options and the alias map need nothing from each other; only the row fetch depends on any of them (it needs the resolved view and the column list), so it still runs after. `requireCaller` in `views-actions.ts` also resolves the role and the identity concurrently — the gate is unchanged, it still returns before any table is touched.

### Frozen header and density

- **Toolbar order**, left to right: **View switcher → Client / Host / Feedback filters → meeting count → keyword filter → Edit columns · Edit filters · Export**. The view and the filters come first because together they frame what the count then reports.
- **Nothing above the rows scrolls away.** Only the rows move; the header stays locked to the body columns horizontally because both live in the same `<table>`.

  **The scroll container is the shared `<Table>`'s own wrapper, not a div of ours** — and getting this wrong is what broke the header on the first two attempts. `components/ui/table.tsx` renders `<div data-slot="table-container" class="relative w-full overflow-x-auto">` around the `<table>`. That `overflow-x: auto` makes the div a scroll container on *both* axes as far as sticky positioning is concerned, so a `sticky top-0` `<thead>` anchors to **it** — not to any scroller wrapped around it. With no bounded height on that container it never scrolls vertically, the sticky never engages, and the header rides away with the body.

  So the height (`calc(100vh - 16rem)`) and `overflow-y: auto` are applied **to that container**, via arbitrary variants, exactly as Portfolio and the To-Do list do it. The scroll listener and `ResizeObserver` attach to the same element, so the virtualization and the sticky header can never disagree about what is scrolling. **Do not reintroduce an outer scrolling div** — it re-breaks the header.

  Header cells carry an explicit opaque `bg-card` at cell level (`[&_th]:bg-card`), so rows cannot show through on scroll. The toolbar is separately `sticky top-0` so it stays pinned if a short viewport lets the page itself scroll.

  Verified in a browser at `scrollTop: 6000`, `scrollLeft: 681`: header top equal to container top (pinned), header and body column offsets identical (aligned), header background opaque white, and 39 of 400 rows in the DOM (windowing still live).
- **Rows are 30px** with `py-0.5` cells — the dense floor, since a 24px avatar circle plus that padding is 28px. `ROW_H` and the cell padding must stay in step: the virtualization spacers are computed from `ROW_H`, so changing one without the other silently misaligns the window.
- **Every text cell truncates with the full value on hover** (`title`), which is what lets Client, Event, Institution and Investor stay narrow without losing anything. No column or value was dropped — condensing is purely visual, and the Excel export keeps full untruncated values.

### Other

- **Keyword filter** — matches across all 13 text columns (dates excluded: "Sep" would match a twelfth of the table). Multiple words are ANDed, so `cancelled fidelity` narrows rather than widens.
- **Windowed rendering** — the full set would be 13k+ DOM nodes, so only the slice near the scroll position is mounted, with spacer rows standing in above and below. Sorting and filtering run over the whole array; only rendering is bounded. Row height is fixed inline (`ROW_H`) because the spacers are computed from it — change one and you must change the other. The scroller's pixel height is **measured** with a `ResizeObserver` rather than hard-coded, since its CSS height is a `calc()` and the windowing maths needs a number.
- **Sorting is part of the view** and runs in the **database**, so clicking a header re-queries with a new `ORDER BY` over the whole set rather than reordering the loaded page — and the choice saves with the view. Always on the underlying value: the Date column orders by the raw timestamp, never the formatted string. `meeting_id` is the tiebreaker on every sort, because the sort column is rarely unique and pagination can otherwise drop or repeat rows at a page boundary.
- **Export to Excel** — exports the **active saved view**: its columns, in its order, over the rows on screen (the view's server-side filter plus the keyword box, in the active sort order). Values stay full and human-readable — the full client NAME, the word "Virtual", the word "Confirmed", the real "Closed - All in" — because the screen's compaction exists to fit a screen and a spreadsheet has no such constraint. Headers use the drawer's full label ("On Behalf Of", not "OBO"). The full client name and `State` are appended if the view does not already show them, since they are the first two questions anyone asks of a CRM dump. Dates are written as real Dates so Excel sorts them natively; blanks stay blank.
- **Open record** — **clicking anywhere in a row** opens the meeting-record drawer (below); rows carry a pointer cursor and the table's standard hover tint. The trailing per-row icon does the same thing and is kept for anyone who aims for it. It replaced the old direct "Open in CRM" link, which now lives in the drawer's action bar alongside the rest of the record.

## The meeting-record drawer

**Clicking anywhere in a meeting row** slides a right-side drawer in over the list — as does the trailing open-record icon, and pressing **Enter** on a focused row (rows are `tabIndex={0}`).

Clicks that land on a genuinely interactive element are left alone: the Client link navigates and does *not* also open the drawer. Rather than hanging `stopPropagation` off each control — which every future control would have to remember — the row handler asks whether the click landed inside `a, button, input, select, textarea, label, [role=button], [role=link]` and stands down if so (`isInteractiveTarget` in `meetings-view.tsx`). Anything interactive added later is covered without touching the row handler. The keyboard handler is guarded the same way: Enter only opens the drawer when the **row itself** holds focus, so Enter on the Client link navigates instead of doing both. **View only** — nothing in it is editable, and nothing writes back.

It uses the shared `<Sheet>` (`components/ui/sheet.tsx`), the same primitive `EventMeetingsPane` wraps, so it behaves like every other drawer in the app: slide-in, dimmed backdrop with the list faintly visible behind, and close via **✕, the backdrop, or Esc**. The drawer renders as a *sibling* of the table, never a wrapper, so opening a record cannot remount the list — **its scroll position and virtualization window are preserved** across open, swap and close. Opening a second record swaps the contents of the one drawer rather than stacking another.

### Layout

- **Header band** with the navy→blue→teal accent down its left edge: "Meeting Record" eyebrow, the **client name as the headline, linked** to the same `/client-detail?account_id=…` the list uses, the event name as subtitle, and a row of pills — Meeting Type, Status (Confirmed `#0F7E72` on `#E3F3EF`; Cancelled and Pending map onto the app's shared `STATUS_PILL_LIGHT` red/amber; anything unrecognised falls back to grey), and the full date/time ("Tue, Nov 3, 2026 · 9:30 AM ET", Eastern).
- **Action bar**: "Open in CRM" (only when a Dynamics base URL resolves), a **disabled** Edit button tooltipped *"Editing arrives when this becomes the system of record."*, and a "View only" badge.
- **Body**: grouped sections, each under the gradient section-underline, two-column grid with notes full-width. Values sit in soft tinted read-only boxes (`#F4F6FB` on `#E4E9F4`) so the drawer already reads as a form. An empty value renders a quiet em dash, never a blank box. Booleans render as a small read-only switch plus Yes/No; people render as the shared avatar circle plus their full name.

### Sections

| Section | Fields |
|---------|--------|
| Overview | Date & Time, Meeting Type, Status, Investor, Client (linked), Institution, City, State/Region, Group Meeting, Hosted in HQ, General Notes |
| Representatives | Booked By, On Behalf Of, Host (may be several), Feedback, Client Booked, Host Notes |
| Planning | Calendar, Profile |
| Feedback | FB in BDA, FB Rec'd, Feedback Notes |
| Logistics · Live meetings | **Context-aware.** Live meetings show Sent, Confirm, Driver, Food Order, Logistics Notes; a **virtual** meeting shows "Not applicable — this is a virtual meeting." instead |
| System | Modified By, Modified On, Created By, Created On |

### Where the data comes from

The list carries only the 14 display columns, so the drawer fetches the full record **on demand** — one row per open, via the `loadMeetingRecord` server action in `app/meetings/actions.ts`. Loading every meeting's `_raw` blob with the list would be far more expensive than the handful of records anyone actually opens.

That action is gated exactly as the page is: the **effective** role must be `super_user`, checked before the query is built, so View-as previews the denial. `_raw` is flattened server-side rather than shipped to the browser.

Fields not flattened on `public.meetings` and therefore read from `_raw`: **City** and **State/Region** (only the lookup *ids* are columns), **On Behalf Of**, **FB Rec'd**, the **second host**, and **Modified By / Created By** (no such columns exist on the table). The same unconfirmed-key caveat as the list applies to On Behalf Of, FB Rec'd and the second host — they render as em dashes rather than breaking if the key names are wrong.

The **event name** comes from the list row, not the record: it lives on the event, not on `public.meetings`.

### Edit-ready, deliberately not editable

Every section is rendered from the field-definition list in `lib/meeting-record.ts` — `{ label, sourceKey, type }` per field, `type ∈ text | date | person | toggle | notes | link` — rather than hand-written JSX per field. Nothing is editable in this pass: no inputs, no form state, no save.

The indirection exists so that turning the drawer into a real editor is a **localized** change: swap the `FieldBox` renderer for an input chosen by `type`, add form state, add a save action. Section order, labels and grouping do not move. `type` already distinguishes toggles and people from plain text precisely because that is what a future input would switch on.

**Do not add editing until the dashboard is actually the system of record.** Today Dynamics is, and this whole app is read-only.

## Where things live

| Thing | Path |
|-------|------|
| Page (server, holds the gate) | `app/meetings/page.tsx` |
| Table (client) | `app/meetings/meetings-view.tsx` |
| **Saved-view writes** | `app/meetings/views-actions.ts` — **the app's only write path; read its header before changing it** |
| Column catalog | `lib/meetings/columns.ts` — derived from the drawer's `MEETING_SECTIONS` |
| View shape, built-ins, default resolution | `lib/meetings/views.ts` |
| Server-side select / filter / sort | `lib/meetings/query.ts` |
| Client / Host / Feedback filters | `QuickFilters` + `loadFilterOptions` in `lib/meetings/query.ts`; controls in `app/meetings/quick-filters.tsx` |
| Filter-option lists | `v_admin_meetings_filter_options` in `sql/03_views.sql` |
| Column picker · filter builder · switcher | `app/meetings/column-editor.tsx` · `filter-editor.tsx` · `view-switcher.tsx` |
| Saved-views table | `meeting_saved_views` in `sql/02_rose_owned_tables.sql` |
| Excel export | `lib/admin-meetings-excel.ts` |
| Row type | `AdminMeetingRow` in `lib/types.ts` |
| View | `v_admin_meetings_all` in `sql/03_views.sql` |
| Status pill colours | `statusPill` in `app/meetings/meeting-record-pane.tsx` — one map, shared by the table pill and the drawer pill |
| Ticker patch | `sql/patches/2026-09-09_admin_meetings_ticker.sql` |
| Patch to run | `sql/patches/2026-09-09_admin_meetings_all.sql` |
| Route gate | `ADMIN_ONLY_ROUTES` in `lib/access-control.ts` |
| Nav entry (CRM block) | `CRM_NAV_ITEMS` + `canSeeCrmNav` in `lib/access-control.ts`; drawn by `components/nav.tsx` |
| Nav-gate tests | `lib/nav-crm.test.ts` |
