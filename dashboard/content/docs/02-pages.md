# 02 — Pages

## What it does (plain language)

This is the map of every page in the dashboard: what it's for, who can see it, and where its numbers come from. Pages are grouped in the sidebar into **Clients, Institutions, Productivity, Logistics, Contracts,** and a pinned **Admin** row.

Remember the access rule from [01 — Access & Users](01-access-and-users.md): plain **users** see only the **Logistics** section; **super-users** see everything. A handful of finance pages exist but aren't linked in the sidebar at all — you reach them by typing the URL (super-user only).

## Technical

"Required role" is derived from `USER_ALLOWED_ROUTES` in `dashboard/lib/access-control.ts`: a route in that list is reachable by `user` **and** `super_user`; anything else is `super_user` only. "Reads" is the main Supabase view/table the page's `page.tsx` queries via `.from(...)`. Labels and grouping come from `dashboard/components/nav.tsx`.

### Clients (super-user only)

| Route | Label | Reads | Purpose |
|-------|-------|-------|---------|
| `/client-statistics` | Statistics | `v_client_statistics` + `v_client_stats_by_*` | Portfolio-wide stats by market cap, region, sector, manager, status, days-left. |
| `/portfolio` | Portfolio | `v_client_portfolio` (+ `v_contract_management`, + `contracts` for the doc link, + `accounts` for the account team and `ai_summary`, + `v_client_detail_recent_note` for the note popover, + `meetings` for the # Intro / # F/U drill-in) | Active-client roster with health status and contract linkage. **Row-scoped** by `resolveClientScope`. **Financials-gated:** without the [Financials permission](01-access-and-users.md), the Contract band's **Retainer** column and **Doc** (contract-document) column are **not rendered at all** — the band shows 4 columns instead of 6 — and `annualized_retainer` / `quarterly_retainer` / `contract_url` are **deleted server-side** before the payload is sent, so an ungranted user never receives them (the `contracts.contract_url` lookup is skipped entirely). **Export PDF** button prints the current filtered/sorted view (branded header + filter summary) via the browser's Save-as-PDF; print styling lives in `app/globals.css` under `@media print` — it prints the rendered table, so a gated view exports without the money columns too. **The Info column is excluded from the PDF** (hover-only content; see [Portfolio columns](#portfolio-columns)). Column groups and their definitions: [Portfolio columns](#portfolio-columns) below. |
| `/client-detail` | Detail | `v_client_detail_summary` + many `v_client_detail_*` (+ base `touchpoints`, + `v_marketing_calendar`) | Deep-dive on one client: quarterly, institutions, hosts, recent meetings/notes. **Row-scoped** by `resolveClientScope` (a direct URL to an out-of-scope client is blocked). **Financials-gated:** the KPI strip is **6 tiles** — Meetings (LTM/All-time) · Institutions (LTM) · Feedback Rec'd (LTM) · **Annualized Retainer** · **$ per Meeting** · Contract Renewal — but without the [Financials permission](01-access-and-users.md) the two money tiles are **not built** and `annualized_retainer` / `dollars_per_meeting_ltm` are **deleted server-side** from the selected client *and* the whole client-switcher list. The row then renders **4 tiles that stretch evenly to fill it** (the grid's column count follows the tile count) — no blanks, no dashes, no placeholders. `dollars_per_meeting_ltm` is derived from the retainer, so it is always gated with it. The **AI Summary** is not gated: there is one summary per client shown to everyone, and it no longer states retainer / fee amounts **for anyone** (renewal dates are still included). The Account Team / AI Summary card also carries a **Marketing Events & Dates** spotlight (from `v_marketing_calendar` filtered to the client — `state_label = 'Active'`, `event_state_label` present and not `'Pause'`, and **as of 2026-09-08 no date cutoff**, so the pool is identical to Outreach Status's), split by the event's **confirmed-meeting dates** (`public.meetings.meeting_date` / Dynamics `bcs_date`; a meeting is a single point in time, so it is both start and end — resolved to the Eastern day). An event with no confirmed meetings falls back to its own `event_start_actual`..`event_end_actual` window. **Current & Upcoming** (left) = every event that **either** has a latest meeting day of today-or-later **or** sits in an **active-booking stage** — `event_state_label IN ('Live Outreach', 'Meetings Ongoing')`, meaning the team is still booking meetings for it, so it stays current even once every meeting booked so far has passed (**no cap**; sorted in two tiers — events with a not-yet-occurred meeting day first, nearest first, then the state-only-qualified ones, most-recently-active first). **Previous** (right) = the exact complement — events where all meetings have ended **and** the event is no longer being booked — showing **only the single most-recently-completed** one. Both columns come from one predicate, so an event can never appear in both. This is the **same qualification rule** `v_client_todo` applies to Outreach Status's Current & Upcoming Event column, over the **same event pool** (see below). Each row shows a date tile (event start = earliest meeting day), the event's start–end span, a **confirmed-meeting count chip** (navy tint; labelled "confirmed" on both columns — confirmed meetings only, excluding tentative/cancelled/any non-confirmed status), and a stage pill colored from `event_state_label` (Live Outreach / Meetings Ongoing → green, Pre-Launch → blue, Schedule Closed → amber, Preparing Feedback / Complete → grey, unknown → grey). The count is `COUNT(public.meetings WHERE event_id = <event> AND meeting_status_label = 'Confirmed')` — the same meetings→event link (`meetings.event_id`, from Dynamics `_bcs_event_value`) and status the Planning views use; queried per selected client's event ids, fail-soft to `0`. Each event row is **clickable** (hover + selected state): it opens that event's confirmed meetings in the **shared right-side detail pane** — `components/event-meetings-pane.tsx` (`EventMeetingsPane`), extracted from here and now shared with Outreach Status, built on the same `Sheet` drawer the Investor Reach Depth section uses (same width / slide-in / header / close). Its rows come from the shared `loadConfirmedMeetingsByEvent` read in `lib/event-meetings.ts`, which also backs the count chip and the Current/Previous bucketing dates — one query for all three. The pane header is the event name + its date span; the body lists confirmed meetings only, sorted by date, each showing date (`meeting_date`), institution (`institution_name`), and investor (`investor_text` / Dynamics `bcs_investor`), with a small empty note if an event has none. The block degrades to empty column placeholders ("No current or upcoming events" / "No previous events") and never blanks the page if the view is missing. |

| `/clients/to-do` | Outreach Status | `v_client_todo` (+ `v_feedback_pipeline` / `v_feedback_outstanding` / `touchpoints` for the hover detail, + `accounts` for the Client Manager filter) | One row per **active** client, filterable by **Client Manager** (options built from the viewer's own scoped rows): meetings YTD/L12M/UPC (YTD and UPC are a clean split of confirmed meetings on `now()` — occurred-this-year vs not-yet-started, no far end, nothing counted twice), last CRM touchpoint, last Outreach → Data Upload, the soonest current/upcoming marketing event (name / stage pill / date window / confirmed meetings / open slots — the whole cluster is **clickable**, opening that event's confirmed meetings in the shared `EventMeetingsPane`, the same drawer Client Detail's Marketing Events block uses, fed by the same `loadConfirmedMeetingsByEvent` read), open feedback reports + collections, and an **inline note** saved on blur to `client_todo_notes` (last write wins, never written back to Dynamics). **Row-scoped** by `resolveClientScope` (account-management team), with a "No clients assigned to you" empty state, and enforced again on the note write. Its own independent role grant. Aging colours: touch 60/90 days, upload 120/180 days. **Export to Excel** downloads the current filtered+sorted view as `.xlsx` (ExcelJS, client-side from the already-scoped rows). **Export PDF** exports that same view as a landscape PDF that mirrors the on-screen table (pills, aging colours, branded header + filter summary) via the browser's Save-as-PDF — the same `window.print()` mechanism as Portfolio, with the shared print styling in `app/globals.css` under `@media print`; because it prints the rendered table it inherits the row scoping, and the inline note textareas are swapped for static text on paper. Requires `sql/20_client_todo.sql`. Full detail in [10 — Outreach Status](10-to-do-list.md). |

#### Portfolio columns

The table has one always-on **Client** group (Client / Status / Team, frozen to
the left edge) plus three toggleable sections, controlled by the **Sections**
segmented control and persisted to `?sections=` in the URL. Default view is
**Contract + Meetings** on, Classification off.

| Section | Columns |
|---------|---------|
| Client *(locked)* | Client · Status · **Info** (note + AI hover icons) · **Cap $B** · Team |
| Classification | Mkt Cap · Region · Sector |
| Contract | Term End · Days · Renew · Term (· Retainer · Doc — Financials-gated) |
| Meetings | L12M · Inst · L3M · Next 3M · **Open** · Last · **Next** · **# Intro** · **# F/U** |

**Removed (2026-09-03) — the Activity section.** The **Last Event** date
(`accounts.last_event_date`) and **Last Note** date
(`accounts.last_touchpoint_date`) columns are gone, and with them the whole
Activity group and its **Activity** Sections pill. The fields are still on
`v_client_portfolio`; nothing on Portfolio renders them.

**Last-meeting recency filter.** Three pills — **Stale meetings** (30–90 days) ·
**Cold meetings** (90+) · **Blank meetings** (never) — sit opposite the Sections
control, filtering on the Meetings **Last** column. They OR together; none
pressed means no filter, **Reset** clears them, and any pressed pill is named in
the Export PDF header's filter summary. Their thresholds are the same ones
`DateCell` uses to pill the Last column, so pressing *Cold meetings* selects
exactly the rows showing a Cold pill.

> These are the survivors of the nine activity pills. The 2026-09-03 cleanup
> removed all nine along with the Activity section, but the **Last** column
> itself stayed (only Last Event and Last Note went), so its three pills were
> restored. The events and notes pills stay gone — the columns they filtered no
> longer exist. The **Stale / Cold** legend at the top of the page was likewise
> kept, and both it and the pill row are now headed "Last meeting:" rather than
> "Activity flags:", which named a section that no longer exists.

**Info** — two small hover icons in the Client group, immediately after
**Status**, each revealing a paragraph of text without leaving the table.

| Icon | Reveals | Source |
|------|---------|--------|
| 📝 note, navy | The client's **most recent note** — heading carries the note's own date | `v_client_detail_recent_note` (`notes_text` / `note_date`) — the same view the Client Detail note card reads, so there is no second definition of "most recent note" |
| ✨ sparkle, teal `#1C8C9C` | The client's **AI summary** | `accounts.ai_summary` — the retainer-free summary the Client Detail card shows, **not** Financials-gated (one summary per client, shown to everyone) |

- Both are read **server-side** in `app/portfolio/page.tsx` and merged by
  `account_id`, and both reads are narrowed with `.in("account_id", …)` to the
  ids that survived `resolveClientScope` — free-text notes and summaries for
  clients the viewer cannot see are never fetched, not merely dropped after the
  fact. Full payload across all 109 active clients is ~105 KB.
- A client missing either one keeps a **muted grey glyph** in its slot (with a
  "No client note on record" / "No AI summary yet" tooltip) rather than an empty
  gap, so the pair never reflows row to row. Today that is 11 clients without a
  note and none without a summary.
- The sparkle and its teal are lifted from the Client Detail **AI Summary**
  `CardTitle`, so the glyph means the same thing on both pages.
- Implementation is the shared `components/cell-hover-card.tsx`. **The panel is
  portalled to `<body>`** — the same fix the collapsed nav rail's fly-out uses
  (`useFlyout` in `components/nav.tsx`) — because two things clip a panel
  rendered inline in a table cell and a z-index beats neither: the table wrapper
  is `overflow-x: auto`, which forces `overflow-y` to auto too and clips on both
  axes; and the sticky `<thead>` (z-20) and sticky frozen columns (z-10/z-30)
  each establish their own stacking context, so a neighbouring sticky cell paints
  over an inline panel however high its z-index goes. Portalled, `position:
  fixed`, `z-[60]`, anchored off the trigger's measured rect.
- 340px wide, flips above the icon when there is not enough room below, and
  scrolls internally when the text is long. **Source line breaks are reflowed**:
  client notes arrive hard-wrapped at ~78 columns (median line 76, max 80 across
  all 103 non-blank notes), which reads as ragged half-lines in a narrow panel,
  so a *single* newline is collapsed to a space. A *blank* line is kept as a real
  paragraph break — no note uses one today, but AI summaries and future notes
  may, and losing real structure is the worse failure.
- **Excluded from the Export PDF.** The content is reachable only by hover or
  focus, and paper has neither — printed, the column is two inert glyphs holding
  space open for nothing. The cells carry `data-print="hide-col"`, which
  **collapses the column to zero width** under `@media print` rather than
  `display: none`-ing it. That distinction matters: the group bands above the
  columns carry a `colSpan`, an HTML attribute CSS cannot rewrite, so removing
  the cells from the table would leave the Client band claiming 5 columns over
  the 4 that remain — measured, it over-ran to 521px while its columns ended at
  407px, shifting every band to its right. Zero-width keeps the colSpans honest,
  and the existing `width: auto` print rule hands the freed 46px back to the
  other columns, so there is no gap. Verified against the real print stylesheet:
  all four bands align to their columns, header matches body, table lays out at
  889px inside the ~979px printable width. On screen the column is unaffected.
  (Portfolio has no Excel export — Export PDF is its only export.)
- **Keyboard and touch:** the trigger is a real `<button>` — focus opens the
  panel, `aria-describedby` links it, Escape closes and returns focus, Tab moves
  into the panel so a long note can be scrolled, and Enter/Space reopens. On
  touch, tap toggles. The panel closes on scroll (capture phase, so the table's
  own inner scroll container counts) rather than chasing a rect it was anchored
  to once.

**Cap $B** — a **Client-group column**, frozen to the left edge between the Info
icons and **Team**, so a client's size stays on screen beside its name however
far the table is scrolled. It is `accounts.market_cap_b`, exposed on
`v_client_portfolio` and loaded from Dynamics **`bcs_marketcapb`**
(`loader/load.py`). **The source is already in billions of US dollars — no unit
conversion is applied.** Displayed to 1 decimal at ≥10 and 2 decimals below
(203.2 · 23.7 · 1.38 · 0.16), right-aligned, `—` when the client has no value.

> It lived in Classification as "Mkt Cap ($B)" for one revision before moving
> here. The header is **"Cap $B"**, not "Mkt Cap": Classification keeps a **Mkt
> Cap** column holding the *bucket* (Mega / Large / Mid / Small / Micro) cut
> from this same figure at ≥200 / ≥10 / ≥2 / ≥0.3, and two columns called "Mkt
> Cap" showing different things would be unreadable. The unit is in the label
> and spelled out in the header's hover tooltip. Sorting is on the number, so it
> orders by actual size rather than alphabetically by bucket name — the observed
> range across the 202 clients carrying a value is 0 → 203.22.

**Next** (`next_meeting_date`) — sits **immediately after Last**, so the group's
two date columns read as a pair: where the client last was, and where it is
next. The forward counterpart to **Last**.

> Headed **"Next"**, not "Next Event". It is a **meeting** metric — the client's
> next confirmed meeting date — with no marketing event involved, so naming it
> after one was misleading. The full label lives in the header's hover tooltip
> ("Next confirmed meeting"). Shortening the header also handed the column's
> width back to its data, which is the same MM/DD/YY date **Last** holds.

- The client's **soonest upcoming confirmed meeting**: `MIN(meeting_date)` over
  `public.meetings` where `meeting_status_label = 'Confirmed'` and the meeting's
  **Eastern calendar day is today-or-later**.
- **Today-or-later, so a day comparison rather than an instant one** — the column
  answers "what day is this client next in front of investors", and a meeting at
  9am today is still today's answer at 4pm. Eastern is the firm's operating day,
  the convention `v_client_todo` and `v_marketing_calendar` settled on.
- This deliberately differs from **Next 3M** earlier in the group, which is a
  strictly-forward count bounded by `meeting_date > now()` — "how much is booked
  *ahead of me*" excludes a meeting that already started. A client whose only
  meeting today is at 9am therefore shows that date under **both** Last and Next
  Event, and **0** under Next 3M. All three are correct answers to three
  different questions.
- Rendered as a plain date, **not** through `DateCell`: the Stale/Cold pills
  measure how long ago something was and mean nothing on a future date. A muted
  **—** shows when nothing is booked ahead (the view returns NULL, not a zero or
  a sentinel date).

**Open** (`open_slots`) — open marketing-event capacity for the client.

- **Event universe:** `public.events` with `state_label = 'Active'` and
  `event_state_label` (Dynamics **`bcs_eventstate`**) in
  **`Pre-Launch` · `Live Outreach` · `Meetings Ongoing`**.
- **Excluded stages:** `Schedule Closed`, `Preparing Feedback`, `Complete` — by
  then the schedule is shut and a remaining slot is not something anyone can
  still fill — plus `Pause`, excluded everywhere else for the same reason.
- **Formula:** `SUM( GREATEST(of_slots − confirmed_meetings, 0) )` across those
  events. `of_slots` is `events.of_slots` (Dynamics **`bcs_ofslots`**);
  `confirmed_meetings` is counted from `public.meetings` on `event_id` where
  `meeting_status_label = 'Confirmed'`, **not** from the lagging
  `events.confirmed_meetings` Dynamics rollup. Identical slot definition to
  Outreach Status's open-slots figure.
- The floor at 0 is per event, before the sum: an overbooked event goes negative
  in Dynamics, and a negative would silently cancel out another event's genuinely
  open slots. Events with a NULL `of_slots` contribute nothing (capacity unknown,
  not zero) — 2 of the 116 currently-qualifying events. A client with no
  qualifying event shows **0**, not a dash.

**# Intro** (`intro_meetings`) and **# F/U** (`followup_meetings`) — the
relationship split of the client's meetings. They **close the Meetings group**,
after the Last / Next date pair. Compact headers; the full labels are in each
header's tooltip.

- An **intro** is the **first (earliest) meeting** between this client and a
  given institution — the first time Rose organized a meeting for that client
  with that institution. Every later meeting between that same pair is a
  **follow-up**.
- Per client: `# Intro` = **count of distinct institutions ever met**, since
  exactly one meeting per (client, institution) pair can be the earliest.
  `# Follow-Up` = **total meetings − # Intro**.
- **Confirmed only** (`meeting_status_label = 'Confirmed'`) and **all-time** — no
  trailing window, unlike the L12M / L3M / Next 3M columns beside them. These are
  lifetime relationship counts.
- Institution identity is `meetings.institution_name`, the same key the **Inst**
  column's `unique_institutions_last_365d` uses. `institution_name` and
  `institution_id` are strictly 1:1 in the data (1,557 distinct of each across
  12,595 confirmed meetings; no name with two ids, no id with two names), so the
  key choice changes no number.
- *Worked example — Loomis AB:* 15 confirmed meetings all-time with 12 distinct
  institutions, so **Intro 12 / F/U 3**. The three follow-ups are the second
  VELA Investment Management meeting (2021-12-20), the third VELA meeting
  (2022-02-23) and the second Redwood Investments meeting (2022-02-23); their
  first meetings (2021-12-09 and 2021-12-02) are the intros.

**Click-to-expand — the per-institution breakdown.** Both count cells are
clickable and open the **same** drill-in drawer for that row's client: an
alphabetical (A→Z) list of every institution the client has met, one row each
showing **Institution · Last meeting date · Meeting count**. Both numbers open
one panel because both are cuts of that single list.

- Same drawer as Outreach Status's event drill-in —
  `components/client-institutions-pane.tsx` is modelled on
  `components/event-meetings-pane.tsx`: same `Sheet`, same `sm:max-w-md` width
  and slide-in, same teal-eyebrow / navy-title / muted-description header, same
  scrolling list. It is a sibling rather than a call into that pane because the
  row shape differs — that one lists individual meetings (institution + investor
  + one date), this one lists institutions with a **count**, which
  `MarketingEventMeeting` has no field for.
- **It reconciles with the cell, by construction.** The rows come from
  `loadInstitutionBreakdownByClient` (`lib/client-institutions.ts`), whose
  predicate is character-for-character the view's `client_institution` CTE:
  `meeting_status_label = 'Confirmed'`, non-null client and institution, and
  **no date filter**. So for every client:

  | | |
  |---|---|
  | rows in the panel | = **# Intro** (one intro per institution) |
  | Σ meeting counts | = **# Intro + # F/U** |

  Verified against the live view for all 109 active clients, and re-checked in
  the rendered page (e.g. Aker BP ASA: 145 rows, counts summing to 299, against
  a cell reading 145 / 154).
- **The window includes future-dated meetings**, because the columns do — 293 of
  the 12,599 confirmed meetings are in the future today. Adding an intuitive
  "only meetings that have happened" bound would make the panel disagree with
  the number just clicked. One consequence: **Last meeting date is `MAX` over
  that same unbounded set, so it can be a future date** for a client with
  something already booked. That is the honest answer for this window.
- Preloaded server-side and passed to the table as a prop (the same shape
  Outreach Status uses for its event drill-in), so the drawer opens instantly with no
  client fetch and no loading state. 6,173 (client, institution) pairs — ~645 KB
  raw but **71 KB gzip / 42 KB brotli**, since institution names repeat heavily.
- A client with no confirmed meetings has nothing to expand, so its `0 / 0`
  render as **plain text, not buttons**. The trigger is a real `<button>`
  (keyboard-reachable, Escape closes the drawer) styled as a bare number that
  underlines only on hover/focus, so the numeric grid still reads as a grid.
  Unchanged on paper: the button collapses to its number in the PDF export.

Open / Intro / F/U live on `v_client_portfolio` and require
`sql/patches/2026-09-03_portfolio_open_slots_intro_followup.sql`; **Next**
requires `sql/patches/2026-09-03b_portfolio_next_meeting_date.sql` on top of it.
Both are folded into `sql/03_views.sql` for a rebuild. Until a patch is run its
columns read as `0` (or `—` for Next) rather than erroring.

### Institutions (super-user only)

| Route | Label | Reads | Purpose |
|-------|-------|-------|---------|
| `/institutions` | Institutions | `v_institution_summary` | Directory of all investor institutions met. **"Institutions" is a single clickable top-level nav item** (the category row itself links here — no child rows). Its masthead has a **Finder** link (top-right) to `/institution-style`. |
| `/institution-style` | Finder | `v_institution_style_meetings` | Find institutions by client style (market cap / sector / region). **Not in the nav** — reached from the "Finder" link on the Directory banner. |

### Productivity (super-user only)

| Route | Label | Reads | Purpose |
|-------|-------|-------|---------|
| `/people-statistics` | Statistics | `v_meetings_monthly`, `v_person_role_ttm`, `v_person_activity_windows`, `v_person_feedback_windows` | People-level activity & feedback statistics. |
| `/productivity` | Summary | `v_productivity_person_meeting`, `v_productivity_person_manager_stats`, `salary_schedule`, `cost_assumptions` | Productivity + cost/salary context per person over a chosen date range. |
| `/productivity-detail` | Detail | `v_productivity_detail_summary`, `v_analyst_monthly_activity`, `v_productivity_detail_institutions` | Per-analyst detail and monthly activity. |
| `/capacity` | Capacity | `v_productivity_person_meeting`, `v_capacity_account_roles` ⚠️, `v_person_role_ttm` | Capacity / manager-role coverage across people. |

⚠️ `v_capacity_account_roles` is read by the Capacity page but is **not defined in `sql/03_views.sql`** — it exists in the live database but is missing from the local repo (repo drift). See [04 — Views](04-views.md).

### Logistics (reachable by plain `user` **and** super-user)

| Route | Label | Reads | Purpose |
|-------|-------|-------|---------|
| `/planning-v2` | Planning | `v_planning_events` | Event planning & logistics tracker (current planning tool). |
| `/calendar` | NDRS Calendar | `v_marketing_calendar` + `public.meetings` (confirmed) | Marketing calendar Gantt. Box source and style depend on the event's stage — see [Calendar box logic](#calendar-box-logic) below. **Note:** the view's trailing two-month cutoff was removed on 2026-09-08 (so Client Detail's event pool would match Outreach Status's), which also widened this page from ~168 to ~838 events and ~93 to ~141 client lanes. Events outside the visible month window draw nothing, so the extra rows surface as **client lanes that look empty** at most zoom levels. If that becomes noisy, re-apply the window in this page's loader rather than in the view. |
| `/scheduler` | Host Calendar | `v_scheduler_meetings`, `v_scheduler_unassigned`, `v_scheduler_time_off` (+ Graph free/busy) | Host availability & scheduling. Also the plain-user home (`USER_HOME_ROUTE`). |
| `/live-outreach` | Live Outreach | `v_live_outreach` | Event outreach board with per-client cards, led by an **Event Summary** roll-up — see below. |
| `/profiles` | Profiles | `v_profiles_upcoming` | Upcoming-meeting profile pipeline board. |
| `/feedback-manager` | Feedback Reports | `v_feedback_pipeline` | The report pipeline — Pending Review + Open (being written) tables with the pipeline-flow KPIs and Claimed By / Account Manager filters. One row per **Feedback task**, not per event: an event can carry several Feedback / Feedback Report Sent **pairs** (plus stray unpaired tasks), matched by **nearest `created_on`** — mutual nearest neighbour within the event — each pair flowing Open → Pending Review → done independently and able to appear in different buckets at once, with unmatched tasks left as orphans (see [Feedback report pairs](07-business-rules.md#feedback-report-pairs-why-an-event-is-not-a-unique-key)). **All-access** (route-gated only, no row scoping). Own "Feedback Reports" banner. |
| `/feedback-collection` | Feedback Collection | `v_feedback_outstanding` | Concluded meetings still needing feedback. **Row-scoped** by the Pass-2 meeting resolver (`resolveMeetingScope`: booker / host / feedback / account-team), with a "No meetings assigned to you" empty-state. Super-users see the Send email / Send test controls (the send route enforces the same gate). Separate route from Reports with its **own independent role grant**. |
| `/feedback` | — (redirect) | — | Redirects to `/feedback-collection`, preserving query params (e.g. the `?client=<id>` deep link). No page of its own. |
| `/onboarding` | Onboarding | `v_client_onboarding` | New-client onboarding checklist tracker. A client stays until its **first Feedback Report Sent task completes** — see [Onboarding membership](#onboarding-membership) below. **Row-scoped** by `resolveClientScope`. |
| `/time-off` | Time Off | `v_time_off` | OOO / Remote calendar. |

#### Calendar box logic

**Colour always means stage; fill always means confirmed-vs-availability.** The two are independent axes and never trade places:

- **Hue** comes from `event_state_label` via `STATE_COLORS` — the same mapping the stage key in the toolbar uses. A box is the event's stage colour whether or not that date has a meeting.
- **Fill** is the only thing that distinguishes the two date sets: **solid** = a confirmed meeting on that date; **outlined + diagonal hatch** (no solid fill) = availability, i.e. a date parsed from the event title with nothing booked. The hatch is drawn in the *same* stage colour at ~35% alpha with transparent gaps, over a 1px outline of the full-strength stage colour — so an availability box reads as unfilled without changing hue.

The toolbar carries a **Confirmed / Availability** swatch pair (deliberately neutral grey — that row is about fill, not hue) beside the stage key, plus a helper line beneath it: *"Solid = confirmed meeting · Outlined = availability. Box color reflects the event's stage."*

Each event can contribute **two date sets**, and its stage (`events.event_state_label`, exposed as `event_state_label`) decides which are drawn and how:

| Stage | Boxes drawn | Style |
|---|---|---|
| **Pre-Launch** | title dates only | outlined + hatched, in the Pre-Launch colour |
| **Live Outreach** | confirmed **and** title | solid where a meeting is confirmed; hatch on title dates with nothing booked. A day that is both → **solid wins** |
| **Schedule Closed** | confirmed only | solid |
| **Preparing Feedback** | confirmed only | solid |
| **Complete** | confirmed only | solid |
| *anything else* | confirmed only | solid — the safe default |

**Confirmed dates are real meeting records**, not parsed text: `public.meetings` rows with `meeting_status_label = 'Confirmed'`, read through the shared `loadConfirmedMeetingsByEvent` in `lib/event-meetings.ts` (the same read behind Client Detail's and Outreach Status's event drill-ins), so "confirmed" means the same thing on every page. `v_marketing_calendar` carries no meetings, so the page loads them alongside the view and chunks the ids — the helper issues one `.in(event_id, …)` per call, and a few hundred events would otherwise overrun a single request URL. The chunks cover **disjoint** event ids, so they are issued **together in one `Promise.all`**, not one after another: with ~840 events that is 9 requests, measured at **~1,220 ms sequentially against ~400 ms in parallel**. Merging happens after they all return, so the result is identical either way, and the fail-soft behaviour is unchanged (a failed chunk still yields no dates for its events rather than blanking the page).

**Title dates** are scraped from the free-text event **name** with one global scan:

```
/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?:\s*[-–]\s*(?:(\d{1,2})\/)?(\d{1,2})(?:\/(\d{2,4}))?)?/g
```

It accepts `6/23`, `6/23/26`, `6/23/2026`, `6/29-7/1` and `6/29-30`; ranges are **expanded into individual days** so both sets are plain sets of days. Scanning beats splitting on commas because the title carries a prefix (`"4DX-AU -  Virtual - "`) — and nothing else in a title has the shape of a slashed number pair.

**Year inference** (the dates carry no year). An anchor is taken from, in order: the event's **earliest confirmed meeting** → else `event_start_actual` → else the current year. Each token then picks whichever of *anchor−1 / anchor / anchor+1* lands it **nearest** the anchor. Nearest-year is what makes both directions work — a naive "a month before the anchor rolls forward" rule pushed a `6/29` on an event whose first confirmed meeting is `7/13` a full year out.

**Failure handling.** A token that doesn't match, names an impossible month/day, or resolves to a date the calendar rejects (`2/30`) is skipped; the remaining tokens still render, and the whole scan is wrapped so one bad title can never blank a lane. There is **deliberately no fallback** to the `event_start_actual..event_end_actual` window any more: at a confirmed-only stage the point is that only real meetings show, so an event with nothing to draw renders an **empty lane**. Both the boxes and the per-day density strip come from the same resolved set, so the heat map can't disagree with the marks.

#### Live Outreach — Event Summary

The page opens with an **Event Summary** card above the detail cards: one compact line per event — number · ticker · client · status flag · confirmed meetings · open slots · dates — split into two columns and read **column-major** (down the left half, then down the right).

**It is the same summary the Live Outreach email leads with.** Both render from `buildLiveOutreachSummary()` in **`app/live-outreach/summary.ts`**, which is the single source for which events appear, in what order, and with what numbers. Only the presentation differs: the email is Outlook-safe nested tables, the page is a normal card + `<table>`. The line numbers are each event's position in the tiered sort from `load.ts`, so they match the numbered detail cards below 1:1 — and the same column-major split means an event sits in the same place in both.

That module also owns `baseTicker` (drops the exchange suffix — `NVCR US` → `NVCR`), `truncateDates`, the ≤2-slots alert threshold, and `liveOutreachTotals` (the "N events · M confirmed meetings" roll-up in the page subtitle and the email header). The page shows the **client name** as an extra column, which the email's narrow fixed-width columns omit; every other field is identical, including the red/bold treatment on tight open slots.

**Summary rows jump to their detail card (page only — the email is unaffected).** Each detail card carries `id="event-<event_id>"`, and each summary row is a real `<a href="#event-…">` covering the whole row, with a brand-blue jump arrow that brightens on hover, a row tint, and an underlined client name. Because the row is a genuine anchor it works with **no JavaScript** — the plain hash jump — and `scroll-mt-16` on the card keeps it clear of the sticky mobile top bar (both the native jump and `scrollIntoView` honour `scroll-margin`). `app/live-outreach/summary-jump.tsx` is a thin client wrapper that upgrades this with **one delegated listener** for the whole summary (not one per row): smooth scrolling, a `replaceState` hash update that avoids a second jump, and a brief blue arrival flash via the Web Animations API. Reduced-motion preferences skip both the smooth scroll and the flash. The row is laid out as a **CSS grid rather than a table row**, because a `<tr>` cannot be wrapped in an anchor and the stretched-`::after` workaround is unreliable.

#### Onboarding membership

**A client appears on the Onboarding page until its first feedback report has been sent, then drops off for good.**

This rule is now **stated on the page itself** — a muted helper line sits under the title, above the filters: *"Clients automatically drop off this list once their first Feedback Report has been sent."* Nothing in the grid counts down to the exit, so without that line the disappearance is only discoverable after the fact. Same muted-italic treatment as the Client Statistics footnote.

Concretely, `v_client_onboarding` keeps an active client only when there is **no** `tasks` row for it with `bcs_task_subtype_label = 'Feedback Report Sent'` **and** `state_label = 'Completed'`. Zero completed report tasks → still onboarding; the first one completing → gone. The task is linked to the client by its own `bcs_account_id`, and identified by subtype label rather than subject text — the same identification and linkage `v_feedback_pipeline` and `v_client_marketing_status` use.

Two details worth knowing:

- **There is no `'Closed'` task state.** `state_label` is the Dataverse statecode and only ever takes `Open` / `Completed` / `Canceled`, so `'Completed'` is the whole of "completed/closed". A **Canceled** report does not count as sent — the client keeps onboarding, which is the intended reading.
- **A client with several events** drops off on its *first* completed report, not per-event. This is a client-grained rule; the per-event report lifecycle lives on the Feedback Reports page.

#### Who is in scope

Membership is **Active** + **no completed Feedback Report Sent** + **(started on/after 2026-01-01 OR contract is blank)**.

The feedback-report rule above is the single **exit**, and it applies to *every* row — including the blank-contract ones. A client with no contract that has already had its first report sent does **not** appear.

The scope half is an either-or:

- **The 2026 floor** — `onboarding_start_date >= 2026-01-01`. Keeps the page on genuinely-new clients, stops legacy clients reappearing now that the step gate is gone, and keeps `days_onboarding` / the 60-day stalled flag meaningful (`original_start_date` otherwise reaches back years).
- **OR the contract is blank** — catches a client being set up that has nothing on file yet. Such a client usually has a **`NULL` `original_start_date`**, which never satisfies the floor, so without this arm it would be invisible.

**"Blank contract" is the exact negation of `v_contract_management.has_active_contract`** — deliberately the same test, so Onboarding and Contract Management can never disagree about whether a client has a contract. A client is blank when **no** `public.contracts` row satisfies:

```sql
state_code = 0
AND (contract_termination_date IS NULL OR contract_termination_date > CURRENT_DATE)
```

That covers both real shapes: no contract row at all, and rows that exist but are all deactivated or already terminated. Note `state_code` is the Dataverse **statecode on the contract**, not `contract_status_label` (`Initial Term` / `Renewal Term` / `Contract Expired` / `Terminated`) — that's the workflow stage, a different axis.

Measured on live data (2026-08-20): 4 Active clients have no live contract; 2 of them have already reported and correctly stay out, so the page goes from **10 rows to 12**. Both additions have no contract row *and* a `NULL` start date, so their **Days** column shows a muted dash and they sort to the bottom (`NULLS LAST`).

Scope (who is eligible at all) and exit (when they leave) remain separate rules.

#### The 9 checklist steps — where each one comes from

Eight steps come straight off the client card in Dynamics (synced onto `public.accounts`); the ninth is derived from a task. **Three of them show a date on a small second line under the checkmark** — no date means an unfilled step and no date line.

| # | Column label | Full name | CRM source | Complete when | Date shown |
|---|---|---|---|---|---|
| 1 | Onb. Call | Onboarding Call | `accounts.onboarding_call` (`bcs_onboardingcall`) — date | a date is present | ✅ that date |
| 2 | Teach-in | Teach-in Date | `accounts.teach_in_date` (`bcs_teachindate`) — date | a date is present | ✅ that date |
| 3 | Calendar | Calendar | `accounts.calendar` (`bcs_calendar`) — boolean | flag is TRUE | — |
| 4 | Cal. Conf. | Calendar Confirmed | `accounts.calendar_confirmed` (`bcs_calendarconfirmed`) — boolean | flag is TRUE | — |
| 5 | Mtg Hist. | Meeting History | **Outreach → Data Upload task** (see below) | a completed Data Upload task exists | ✅ that task's date |
| 6 | Distro | Distro | `accounts.distro` (`bcs_distro`) — boolean | flag is TRUE | — |
| 7 | BDA Peers | BDA Peers | `accounts.bda_peers` (`bcs_bdapeers`) — boolean | flag is TRUE | — |
| 8 | Rec. Call | Recurring Call Scheduled | `accounts.recurring_call_scheduled` (`bcs_recurringcallscheduled`) — boolean | flag is TRUE | — |
| 9 | Report | Report | `accounts.report` (`bcs_report`) — boolean | flag is TRUE | — |

For the six boolean steps, a **No** and an **unset** flag are treated identically — both read as "missing" (muted dash). Only TRUE ticks the box.

**Meeting History is sourced from the Data Upload task, not a flag.** It is complete when the client has a **Completed** `tasks` row with `bcs_task_type_label = 'Outreach'` and `bcs_task_subtype_label = 'Data Upload'`, linked by `bcs_account_id`; the date shown is that task's `actual_end` (latest task wins if there are several), read as an Eastern calendar day. This is the *same* CTE Outreach Status uses for its **Last Data Upload** column, so the two pages can't disagree about when a client last uploaded.

It replaced `accounts.meeting_history_received` (`bcs_meetinghistoryrecd`), which is **still synced but no longer feeds this step** — that flag was `false` on every client on the page, so the step could never tick. Re-sourcing took it from 0 of 10 clients to 5 of 10. The view column was renamed `f_meeting_history_received` → **`f_meeting_history`** to match, deliberately rather than leaving a column named after a source that no longer feeds it.

> **Deployment note (2026-08-20).** The step dates and the Data-Upload re-sourcing were written into `sql/03_views.sql` and the page code, but the **live view was never rebuilt from that file** — it still exposed `f_meeting_history_received` and had none of the three date columns. The page therefore read `undefined` for every date and for `f_meeting_history`, so Meeting History always rendered as missing and no dates ever printed. `sql/patches/2026-08-20_onboarding_dates_contract_notes.sql` reconciles live with the repo and adds the two reference columns below. **A SQL change only takes effect once it is run against Supabase.**

#### Three reference columns (not steps)

None of these count toward `filled_count` or the N/9 ring.

| Column | CRM source | Display |
|---|---|---|
| **Contract Start** | `contracts.contract_start_date` (`bcs_contractstartdate`) | the contract **term** start, `mm/dd/yy`; `—` when the client has no contract row |
| **First Event** | `events` + `meetings` (see below) | abbreviated event name over start date · stage pill; `—` when the client has no dated event |
| **Notes** (last column) | `accounts.onboarding_notes` (`bcs_onboardingnotes`) | note icon; hover **or keyboard focus** reveals the free text |

**Contract Start is not the onboarding start.** `onboarding_start_date` / `days_onboarding` anchor on `accounts.original_start_date` (`bcs_originalstartdate`); Contract Start is the separate contract-term field. On current data the term begins about a day *after* the onboarding anchor, so the two are not interchangeable. A client can hold several contract rows (each renewal is its own row), so the view picks deliberately: an **active** term (`Initial Term` / `Renewal Term`) wins over an expired or terminated one, and among those the **latest start** wins — the same choice `v_client_detail_active_contract` makes, with a fallback so a lapsed-only client still shows a date.

**First Event is the client's earliest marketing event**, exposed by the view as `first_event_name` / `first_event_date` / `first_event_state_label`. The event's window starts at the **earliest Eastern day of its confirmed meetings**, falling back to its own `event_start_actual`/`event_end_actual` when it has none — the identical bucketing to Client Detail's "Marketing Events & Dates" block and Outreach Status's `next_event_*` columns. The only difference is direction: Outreach Status picks the *soonest upcoming* event, Onboarding picks the *earliest ever*, so there is deliberately **no date floor** — an onboarding client's first event is usually already in flight or past, and an upcoming-only filter would blank the column exactly when it matters. Event universe matches `v_marketing_calendar` (`state_label = 'Active'`, `event_state_label` present and not `Pause`) — the two are now identical, since that view's trailing two-month cutoff was removed on 2026-09-08. Undated events are skipped, so the column never shows an event with no date.

Display is compact: the leading **`TICKER - ` is stripped** with the shared `stripTickerPrefix` helper (the ticker is already the row's identity two columns left, so the prefix is pure duplication — `"DSFIR-NL - Virtual, Live - Toronto…"` → `"Virtual, Live - Toronto…"`). CRM event names still run long because they carry the full meeting-date list, so the cell caps at 150px and truncates with `…`; the **untouched original name is on hover**. The stage renders as an abbreviated pill (`Meetings Ongoing` → `Mtgs On`, `Schedule Closed` → `Sched Closed`). Colours come from **`EVENT_STAGE_PILL` in `lib/design.ts`** — now the single source of truth, shared with Client Detail and Outreach Status (it had been duplicated in both). An unrecognised stage falls back to grey and shows its raw label, so a new CRM state surfaces rather than vanishing.

**Onboarding Notes** is free text straight from Dynamics, already synced by `mapAccount`. The view normalises blank and whitespace-only values to `NULL`, so the page has one "no note" case: a **greyed, non-interactive** icon. A client with a note gets a live icon whose panel shows the full text, preserving its line breaks. The reveal is the same hover/focus pattern Outreach Status uses for touchpoint detail — with one addition: the card is `overflow-x-auto`, which forces vertical clipping too, so the **bottom two rows open the panel upward** (a downward panel on the last row was measurably clipped by 62px).

**The 9 onboarding steps are now progress display only.** They still render as the grid and the "N/9" ring, and are still sortable, but they no longer decide membership. They previously did, via a `filled_count < 9` gate — that gate had become inert, because the step flags are barely maintained in Dynamics: when the rule was changed (2026-08-20) the highest `filled_count` across all 28 in-scope clients was **1 of 9**, so the gate had never actually dropped anyone. Switching to "first report sent" took the page from **28 rows to 10**. A consequence: a row can now legitimately show **9/9 and still be listed** (every step ticked, report not yet sent), so the completion ring's "complete" state is reachable for the first time.

### Contracts (super-user only)

| Route | Label | Reads | Purpose |
|-------|-------|-------|---------|
| `/contract-management` | Contracts | `v_contract_management` | Active contract + renewal tracking per client. **"Contracts" is a single clickable top-level nav item** (the category row itself links here — no child rows). |

### Admin (pinned nav row, super-user only)

| Route | Reads | Purpose |
|-------|-------|---------|
| `/admin` | `sync_runs`, `sync_errors`, `deletion_candidates`, `cron_send_log` (+ table counts) | Admin hub — system-health tiles + links. |
| `/admin/sync` | `sync_runs`, `sync_errors` | Per-entity sync status; "Run sync now" button. |
| `/admin/reconciliation` | `deletion_candidates`, `reconcile_runs` | Review records deleted in Dynamics before they drop. |
| `/admin/database` | `sync_runs`, `sync_errors` (+ row counts) | Mirror-table row counts, watermarks, recent errors. |
| `/admin/docs` | markdown files + live catalog panels | This documentation, in-app. |

#### Admin hub section layout

The hub (`dashboard/app/admin/page.tsx`) is five sections. **Every destination appears exactly once.**

The three system-plumbing pages — **Sync**, **Reconciliation**, **Database** — all live under **Live health**, reached from their own status tile. Each tile shows the numbers *and* is the way in to the full page, so there is one link per destination and no second copy under In-app tools.

| Section | Contents |
|---------|----------|
| **Live health** | Six status tiles. Three link out: **Sync** → `/admin/sync` · **Reconciliation** → `/admin/reconciliation` · **Database** → `/admin/database`. Three are readouts with no link: **Sync errors**, **Scheduled emails**, **Build**. |
| **In-app tools** | People-and-content management only: **Users** (`/admin/users`) · **Roles** (`/admin/roles`) · **Account Teams** (`/admin/account-teams`) · **Audit Log** (`/admin/audit-log`) · **Documentation** (`/admin/docs`). It does **not** list Sync, Reconciliation or Database. |
| **Maintenance** | On-demand jobs (Refresh AI summaries). Click-to-run; the crons are unaffected. |
| **Hidden Pages** | The `HIDDEN_PAGES` array — see below. |
| **External dashboards** | Vercel, Supabase, Dynamics, GitHub, Status. Off-site links only. |

**The Sync errors tile has no link on purpose.** It used to point at `/admin/sync` — the same page as the Sync tile directly above it — which made `/admin/sync` the hub's most duplicated destination. The errors it summarises are on the Sync page, one tile up.

**Rule when adding to the hub:** link a destination from *one* place. If a page already has a Live-health tile, that tile is its entry point — don't add a matching card under In-app tools. Before 2026-09-16 the hub linked `/admin/sync` three times and `/admin/reconciliation` and `/admin/database` twice each.

### CRM (nav rail, super-user only)

The bottom block of the nav rail, behind a "CRM" divider. Both read unscoped admin views with the service-role key and are in `ADMIN_ONLY_ROUTES` — super-user-only and **not** grantable through the Roles matrix.

| Route | Label | Reads | Purpose |
|-------|-------|-------|---------|
| `/meetings` | Meetings | `v_admin_meetings_all` | Every meeting in the CRM. See [12 — Meetings](12-meetings-all.md). |
| `/events` | Events | `v_admin_events_all` | Every marketing event in the CRM. See [13 — Events](13-events.md). |
| `/tasks` | Tasks | `v_admin_tasks_all` | Every task in the CRM — all types, all states, opening on **Open tasks** sorted by due date. See [14 — Tasks](14-tasks.md). Needs `sql/patches/2026-09-11_admin_tasks.sql`. |
| `/contacts` | Contacts | `v_admin_contacts_all` | Every contact in the CRM — the people at client companies, opening on **Active contacts** sorted by last activity. See [19 — Contacts](19-contacts.md). Needs `sql/23_contacts_table.sql` **and** `sql/patches/2026-09-16_admin_contacts.sql`. |

#### "Add New" buttons and the quick-add menu — PLACEHOLDERS, not wired up

> **These create nothing.** They are visual scaffolding staged ahead of the CRM cutover. There is no form, no Server Action, no database write and no navigation behind any of them. Clicking one shows a **"Coming soon — record creation isn't enabled yet"** toast and stops there. The toast exists so a click reads as *deliberate* rather than broken.

Two entry points (1–2), plus the hover treatment they sit alongside (3). All added 2026-09-16:

1. **Per-page button** — top-right of each CRM page's masthead (`ListTitleCard`'s `rightSlot`), solid brand blue→teal as the page's primary action: **+ Add New Meeting / Event / Task / Touch / Note**.
2. **Nav quick-add** — a **filled teal "+"** in the CRM block of the nav rail, **opening on hover** into a five-item menu: *New Meeting · New Event · New Task · New Touch · New Note*. Filled where the CRM destinations above it are outlined — outlined means "a place to go", filled means "a thing to do".

   It opens through the rail's own `useFlyout`, the same hook every other rail fly-out uses, so the behaviour is identical rather than merely similar: open on mouse-enter, the same 80ms grace period so crossing the gap to the panel doesn't flicker it shut, the same fixed positioning off the trigger's measured rect (`rect.right + FLYOUT_GAP`), the same portal out of the clipping `<nav>`, and the same keyboard handling — focus opens it, Tab walks into the panel, Escape closes and returns focus. `align="bottom"`, so it grows upward from the bottom-pinned CRM block. It is a **disclosure** (`aria-expanded` + `aria-controls`), not `role="menu"`: the panel carries a heading and rule above its items like every other fly-out, and `role="menu"` permits only `menuitem` children.

3. **Mild hover fill on the CRM nav items.** Meetings / Events / Tasks / Touches / Notes previously showed a background only when **active**. Non-active items now take a faint wash on hover, in both the expanded sidebar and the collapsed rail, with the existing `transition-colors`. The token is `CRM_TEAL_HOVER_TINT` (`CRM_TEAL` at 5%), which sits to `CRM_TEAL_TINT` (10%, active) exactly as `RAIL_HOVER_TINT` (6%) sits to `RAIL_ACTIVE_TINT` (12%) on the reporting rows — hover reads as a step short of active, so the two are never confused. Mixed from `CRM_TEAL` rather than reusing `RAIL_HOVER_TINT` directly, because the CRM block is deliberately a different hue from the reporting ramp; applied the same way those rows do it, as a CSS custom property, since an inline style cannot express `:hover`. **The active state is unchanged**, and these remain plain navigation links.

   One trap worth recording: the collapsed rail's CRM tile used to set `backgroundColor: "transparent"` inline for the inactive state. An inline background-color outranks a `hover:bg-*` class, so it silently cancelled the wash — it is now `undefined`.

**Everything funnels through one stub**, `onAddNew(entity)` in `dashboard/components/crm-add-new.tsx`. That is the point of the shape: when create flows land, replacing that one function body (open a drawer, route to `/meetings/new`, call an action) lights up all six controls at once. No call site changes.

**Gating is inherited, not re-implemented.** The buttons sit inside pages that already `redirect("/no-access")` for a non-super-user server-side; the quick-add sits inside the nav CRM block, which renders nothing at all unless `canSeeCrmNav` passes. There is deliberately no second role check in `crm-add-new.tsx` — a copy of the rule there could drift from the one that actually enforces it.

### Hidden Pages (linked from Admin, super-user only)

Parked pages — pulled off the main nav but kept reachable from the **Hidden Pages** section on the Admin hub (`dashboard/app/admin/page.tsx`, the `HIDDEN_PAGES` array). Their routes/pages are unchanged; they're super-user-only now because Admin is (and they were removed from `USER_ALLOWED_ROUTES`). Add another parked page with one `{ href, label }` line in `HIDDEN_PAGES`.

> **`/meetings` is no longer here.** It moved to the **bottom of the main nav rail** as a super-user-only **CRM** entry (its own section break, teal outline). Gating is unchanged — still `ADMIN_ONLY_ROUTES`. See [01 — Access & users](01-access-and-users.md#the-crm-block-in-the-nav-rail).

| Route | Label | Reads | Purpose |
|-------|-------|-------|---------|
| `/pipeline` | Upcoming Meetings | `v_pipeline_30d`, `v_scheduler_meetings`, `v_scheduler_time_off` | Next-30-days meetings. |
| `/relationships` | Relationships | `v_relationships` | Who at Rose owns each institution relationship. |
| `/conference-rooms` | Conference Rooms | `/api/conference-rooms` (Graph, client-side) | Single-day room availability across the four rooms. |
| `/ooo-summary` | OOO Summary | `new_vacationrequest` (the mirror table, **not** `v_time_off`) | Business days taken per person, per year, per category. See [11 — OOO Summary](11-ooo-summary.md). |
| `/meetings` **(nav rail → CRM)** | Meetings (all CRM) | `v_admin_meetings_all` | Every meeting in the CRM — all statuses, all dates, active **and** deactivated, **no row scoping**. Reproduces the Dynamics "Investor Meetings (All)" view. **Saved views**: System (shared) + Personal (private, tied to the login), with per-user defaults; the five old presets are built-in System views and **Upcoming (today or later)** is the fallback default. Columns, filters and sort are all part of the view and all applied **server-side**, so only the selected set is fetched (**All meetings** is the one view that still loads all ~13.6k rows). Saved-view writes are the app's first write path — see [12 — Meetings (all CRM)](12-meetings-all.md#security-model-for-saved-views). Gated harder than the rest of this table: it is in `ADMIN_ONLY_ROUTES` and cannot be opened to another role from the Roles matrix. See [12 — Meetings (all CRM)](12-meetings-all.md). |

### Unlinked / hidden routes (super-user only — not in the nav)

These have a `page.tsx` but no sidebar link; reach them by URL.

| Route | Reads | Note |
|-------|-------|------|
| `/` (home) | same as `/client-statistics` | Home = Client Statistics. Plain users are redirected to `/scheduler`. |
| `/planning` | `v_planning_events` | **Old planning page — kept but deliberately unlinked**, superseded by `/planning-v2` (see comments in `nav.tsx` and `access-control.ts`). |
| `/institution-detail` | `v_institution_detail_summary` + `v_institution_detail_*` | One-institution deep-dive (quarterly, top clients, style, hosts). **Route kept but unlinked from the nav** — reached by drilling in from the Directory (`/institutions`), not typed by URL. Still super-user-only (unchanged `USER_ALLOWED_ROUTES`). |
| `/margin` | `v_client_quarterly_pnl` | Client quarterly P&L / margin. |
| `/renewals` | `v_contract_renewals` | Contract renewal calendar. |
| `/exceptions` | `meetings`, `v_meeting_costs`, `v_client_quarterly_pnl`, overhead tables | Data-quality exception report for the cost model. |
| `/cost-assumptions` | `cost_assumptions` | Cost-model assumptions entry. |
| `/direct-costs` | `client_direct_costs` | Client direct-cost entry. |
| `/overhead-overrides` | `overhead_overrides` | Per-account/period overhead overrides. |
| `/quarterly-overhead` | `overhead_periods` | Quarterly overhead totals. |
| `/revenue-overrides` | `revenue_overrides` | Revenue overrides. |
| `/salary-schedule` | `salary_schedule` | Salary schedule maintenance (feeds the cost model). |

### Auth pages (out of the role system)

`/login` and `/auth/*` are public paths handled in `proxy.ts`. `/no-access` is the request-access landing — the only entry in `ALWAYS_ALLOWED_ROUTES`, reachable by any signed-in user including role-less ones.
