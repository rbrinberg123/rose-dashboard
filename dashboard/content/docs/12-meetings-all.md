# 12 — Meetings (all CRM)

> **Status: built, pending SQL.** The page is at `/meetings`, reachable from **Admin → Hidden Pages → Meetings**. It needs `sql/patches/2026-09-09_admin_meetings_all.sql` run in Supabase before it will load.

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

## The 14 columns

Order matches the CRM view. Every column is sortable; the default sort is **Date descending**, as in Dynamics.

| # | Column | Source | Notes |
|---|--------|--------|-------|
| 1 | Meeting Type | `meetings.meeting_type_label` | Live / Virtual |
| 2 | Meeting Status | `meetings.meeting_status_label` | |
| 3 | Date | `meetings.meeting_date` | Stored UTC, rendered **Eastern**, compact single line: `11/18/26 11:30 AM` |
| 4 | Client | `meetings.client_account_name` | **Links** to `/client-detail?account_id=…` |
| 5 | Event | `events.name` | **Joined** — `meetings` carries `event_id` but no event name |
| 6 | Institution | `meetings.institution_name` | |
| 7 | Investor | `meetings.investor_text` | Free text; may name several people. Shown as a **full name** — see below |
| 8 | Host | `meetings.host_name` **+ `_raw`** | A meeting can have more than one host; the view concatenates the flattened host with a second one from `_raw` when present. Shown as **initials** |
| 9 | Feedback | **`_raw`** → `_bcs_feedback_value` formatted value | The feedback assignee. Same expression `v_feedback_outstanding` uses. Shown as **initials** |
| 10 | Booked By | `meetings.booker_name` | Shown as **initials** |
| 11 | On Behalf Of | **`_raw`** | Rose custom lookup first, falling back to the Dataverse `createdonbehalfby`. Shown as **initials** |
| 12 | Calendar | `meetings.calendar_label` | |
| 13 | FB in BDA | `meetings.feedback_bda_label` | |
| 14 | FB Rec'd | **`_raw`** | Rendered as text — Dynamics may model this as a Yes/No flag *or* a date, and the view passes the formatted value straight through |

### Column display

Three display conventions, all screen-only — the underlying data, the row set, filtering and access gating are untouched by them.

- **Staff columns render the standard initial-circle avatars.** Host, Feedback, Booked By and On Behalf Of use the shared `AccountTeamAvatars` component (`components/account-team-avatars.tsx`) — the same 24px overlapping circles as the Portfolio, Profiles and Onboarding account-team clusters, so a circle here is the same object as a circle there. Each carries its own `Role: Full Name` tooltip.

  Initials come from that component's own logic — `lookupInitials` against the global account-team directory, including the three-letter `KMu`/`KMi` disambiguation when two people's initials collide. None of it is reimplemented here; this page only splits a multi-person cell and picks the colour.

  A cell can hold more than one person (Host, mainly, where the view concatenates hosts with `", "`) — each becomes its own circle in the cluster.

  Colours are one hue per **column**, drawn from the same navy→teal ramp as `ACCOUNT_TEAM_ROLES` in `app/portfolio/portfolio-table.tsx`: Host navy, Feedback blue, Booked By teal, On Behalf Of light teal (dark text, as on Portfolio). One hue per column rather than per person is what keeps the four readable once the names are gone.

  These columns' width floor is the **header text**, not the circles — two overlapping circles need only 40px.
- **Investor stays a full name**, deliberately: it is the row's primary *external* identifier, not internal staff.
- **Client links** to `/client-detail?account_id=…`, the same destination the Portfolio, To-Do and Onboarding tables use. A row with no account id renders plain text rather than a dead link.
- **Date is one compact line** — `11/18/26 11:30 AM`, Eastern. The `MM/dd/yy` shape matches the other tables (see `DATE_FMT` in `app/feedback-manager/feedback-manager-view.tsx`).

Two things the abbreviations deliberately do **not** change:

- **Sorting and the keyword filter still work on the full underlying values.** Sorting the Date column orders by the raw timestamp, not the formatted string; typing `Mavroidis` still finds a row whose Host cell shows only an `NM` circle.
- **The Excel export keeps full values** — full names, a real date-time cell formatted `yyyy-mm-dd hh:mm`, and the client as plain text. Initials are a screen convenience, not the data.

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

### The View dropdown

A preset filter beside the keyword box. **All meetings** is the default — an unfiltered page is the whole point of this view. Presets and the keyword box **combine (AND)**, and the row count and the Excel export both reflect whatever is active.

All date logic is **Eastern** (`America/New_York`), via an `en-CA` `YYYY-MM-DD` formatter — the same approach as `EASTERN_YMD` in Client Detail. Those strings compare lexicographically, so string comparison *is* date comparison.

| Preset | Definition |
|--------|------------|
| **All meetings** | No filter. The default. |
| **Happening today** | The meeting's Eastern calendar day equals Eastern today. |
| **Pending status** | `meeting_status_label` starts with "pending", case-insensitively — see the caveat below. |
| **Upcoming (today or later)** | Eastern day **≥** Eastern today. Today-or-later, not strictly future, so a meeting earlier this morning still counts. |
| **Upcoming, no host assigned** | Eastern day ≥ today **and** the Host cell is empty. |

A meeting with no date matches none of the date presets — an absent date is not "today" and not "upcoming".

Each option shows its row count, computed over the **full** set rather than the keyword-filtered one, so the labels hold still while someone types.

**Caveat on Pending.** The exact stored label could not be confirmed: only `'Confirmed'` and `'Cancelled'` appear anywhere in this repo. The predicate therefore matches the *prefix* "pending" case-insensitively, so `Pending`, `pending` and `Pending Confirmation` all qualify. **The count in the dropdown is the diagnostic** — a "Pending status (0)" means the real label shares no prefix with "pending", and the fix is the one `isPendingStatus` predicate in `app/meetings/meetings-view.tsx`. To settle it:

```sql
SELECT meeting_status_label, count(*)
FROM public.meetings
GROUP BY 1 ORDER BY 2 DESC;
```

**"No host" reads the host NAME, not `host_id`** — the view exposes `host_names`, not the id. The name is the Dynamics formatted value of the same lookup so the two agree in practice, but a meeting whose `host_id` failed to resolve to a name would read as unassigned. Expose `host_id` on the view if that ever needs to be exact.

### Frozen header and density

- **Toolbar order**, left to right: **View dropdown → meeting count → keyword filter → Export**. The preset comes first because it frames what the count then reports.
- **Nothing above the rows scrolls away.** Only the rows move; the header stays locked to the body columns horizontally because both live in the same `<table>`.

  **The scroll container is the shared `<Table>`'s own wrapper, not a div of ours** — and getting this wrong is what broke the header on the first two attempts. `components/ui/table.tsx` renders `<div data-slot="table-container" class="relative w-full overflow-x-auto">` around the `<table>`. That `overflow-x: auto` makes the div a scroll container on *both* axes as far as sticky positioning is concerned, so a `sticky top-0` `<thead>` anchors to **it** — not to any scroller wrapped around it. With no bounded height on that container it never scrolls vertically, the sticky never engages, and the header rides away with the body.

  So the height (`calc(100vh - 16rem)`) and `overflow-y: auto` are applied **to that container**, via arbitrary variants, exactly as Portfolio and the To-Do list do it. The scroll listener and `ResizeObserver` attach to the same element, so the virtualization and the sticky header can never disagree about what is scrolling. **Do not reintroduce an outer scrolling div** — it re-breaks the header.

  Header cells carry an explicit opaque `bg-card` at cell level (`[&_th]:bg-card`), so rows cannot show through on scroll. The toolbar is separately `sticky top-0` so it stays pinned if a short viewport lets the page itself scroll.

  Verified in a browser at `scrollTop: 6000`, `scrollLeft: 681`: header top equal to container top (pinned), header and body column offsets identical (aligned), header background opaque white, and 39 of 400 rows in the DOM (windowing still live).
- **Rows are 30px** with `py-0.5` cells — the dense floor, since a 24px avatar circle plus that padding is 28px. `ROW_H` and the cell padding must stay in step: the virtualization spacers are computed from `ROW_H`, so changing one without the other silently misaligns the window.
- **Every text cell truncates with the full value on hover** (`title`), which is what lets Client, Event, Institution and Investor stay narrow without losing anything. No column or value was dropped — condensing is purely visual, and the Excel export keeps full untruncated values.

### Other

- **Keyword filter** — matches across all 13 text columns (dates excluded: "Sep" would match a twelfth of the table). Multiple words are ANDed, so `cancelled fidelity` narrows rather than widens.
- **Windowed rendering** — 10k+ rows would be 10k DOM nodes, so only the slice near the scroll position is mounted, with spacer rows standing in above and below. Sorting and filtering run over the whole array; only rendering is bounded. Row height is fixed inline (`ROW_H`) because the spacers are computed from it — change one and you must change the other. The scroller's pixel height is **measured** with a `ResizeObserver` rather than hard-coded, since its CSS height is a `calc()` and the windowing maths needs a number.
- **Sorting** works within any preset, and always on the underlying value — the Date column orders by the raw timestamp, never the formatted string.
- **Export to Excel** — exports the **current view** (preset + keyword applied, in the active sort order), not the whole dataset. Adds `State` as a 15th column. Dates are written as real Dates so Excel sorts them natively; blanks stay blank.
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
| Excel export | `lib/admin-meetings-excel.ts` |
| Row type | `AdminMeetingRow` in `lib/types.ts` |
| View | `v_admin_meetings_all` in `sql/03_views.sql` |
| Patch to run | `sql/patches/2026-09-09_admin_meetings_all.sql` |
| Route gate | `ADMIN_ONLY_ROUTES` in `lib/access-control.ts` |
| Admin → Hidden Pages link | `app/admin/page.tsx`, the `HIDDEN_PAGES` array |
