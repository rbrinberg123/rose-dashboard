# 11 — OOO Summary

> **Status: built.** The page is **Logistics → OOO Summary** (`/ooo-summary`), parked off the main nav and reachable from **Admin → Hidden Pages**. The rules below are implemented in `lib/ooo-summary/compute.ts` and covered by 32 unit tests in `compute.test.ts`.
>
> **There is no `v_ooo_summary` view** — the tally is computed in TypeScript, not SQL. See *Why TypeScript and not a view* under Technical.

## What it does (plain language)

The **Time Off** page (`/time-off`) answers "*who is out this week?*". The OOO Summary answers a different question: "**how much time has each person taken this year, and of what kind?**"

It is a tally, not a calendar. One row per **person per year per category**, counting **business days** — so a Monday-to-Friday vacation is 5 days, not 7, and a week containing July 4th is 4.

### The four categories

Every request is bucketed into exactly one of four:

| Category | Which Dynamics request types | Why it's separate |
|----------|------------------------------|-------------------|
| **Remote** | `Remote Work` | Not time off at all — the person is working. Counted so you can see remote patterns, never added to a time-off total. |
| **Sick** | `Sick Leave` | Tracked apart from planned leave; usually unplanned and often policy-separate. |
| **Jury Duty** | `Jury Duty` | Civic obligation, not discretionary absence — it shouldn't count against anyone's time-off total. |
| **Time Off** | **everything else** — `Vacation`, `Personal`, `Other` | Planned, discretionary absence. The number people mean when they say "days off". `Personal` and `Other` belong here: they are days the person chose to take. |

This is a deliberate **catch-all** rule: any *new* request type that appears in Dynamics lands in **Time Off** automatically rather than being silently dropped. That is the safe default, but it means a genuinely different kind of absence (parental leave, bereavement) would be quietly folded into vacation numbers until someone adds it to the table above. **Review the type list whenever Dynamics adds a request type.**

**Jury Duty is currently a category of one** — a single request in 450. Expect the column to be empty for almost everybody; that is the point of splitting it out rather than a sign something is broken.

> **Note on the split.** This is *not* the two-value split the Time Off page uses. That page collapses everything to `Remote` vs `OOO` (see `v_time_off`, and [04 — Views](04-views.md)). The summary pulls `Sick Leave` and `Jury Duty` out of the Time Off bucket, so **Summary "Time Off" ≠ page "OOO"**. Expect the two to disagree by exactly the sick days plus the jury-duty days.

### Counting business days

A request is stored as an inclusive date range (`start_date` … `end_date`). The summary walks every calendar day in that range and counts a day **only if** it is:

1. **Monday–Friday** — Saturdays and Sundays never count, and
2. **not a US stock-market holiday** — the **NYSE** calendar.

So a request of Fri 3 Jul – Mon 6 Jul 2026 counts as **1 day**: the 3rd is the observed Independence Day holiday, the 4th–5th are the weekend, and only Monday the 6th is a business day.

**Why NYSE and not the federal calendar.** The firm's working year follows the market, not the government. The two lists differ in both directions:

- **Good Friday** is an NYSE holiday but *not* a federal one — it counts as a day off here.
- **Columbus Day** and **Veterans Day** are federal holidays but the market is **open** — they count as ordinary business days here.

The ten NYSE holidays, with the market's own weekend-shift rule (falls on Saturday → observed the Friday before; falls on Sunday → observed the Monday after):

| Holiday | Date rule |
|---------|-----------|
| New Year's Day | January 1 |
| Martin Luther King Jr. Day | 3rd Monday in January |
| Washington's Birthday | 3rd Monday in February |
| Good Friday | Friday before Easter Sunday |
| Memorial Day | last Monday in May |
| Juneteenth | June 19 |
| Independence Day | July 4 |
| Labor Day | 1st Monday in September |
| Thanksgiving | 4th Thursday in November |
| Christmas Day | December 25 |

Two things this list does **not** cover, and neither should be inferred automatically: the market's **early closes** (the half-sessions before Independence Day and after Thanksgiving) are full working days here, and **unscheduled closures** (a national day of mourning, a weather closure) are not on any rule-based calendar and would have to be added by hand.

### The half-day rule

Some requests are for half a day. Dynamics has **no half-day field** — the only signal is what the submitter typed in the request's comments box. When that comment indicates a half day (`half`, `half day`, `half-day`, `half a day`, or `1/2 day`, case-insensitive):

> Only the **last business day** of the request counts as **0.5**. Every other business day in the range counts as a full **1.0**.
>
> **total = (business days − 1) + 0.5**

A single-business-day request therefore counts 0.5, which is the common case. A longer one keeps its full days and only gives up half of the last:

```
2026-02-11 .. 2026-02-14   Vacation   "Half day on 2/11!"
   Wed 11  full   1.0
   Thu 12  full   1.0
   Fri 13  half   0.5   ← last business day
   Sat 14  weekend, not counted
                  = 2.5 days
```

**The "last day" is always the last *business* day.** Weekends and NYSE holidays are removed before the half is applied, so the ½ can never land on a Saturday or a market holiday. If a request runs Mon 29 Jun – Sun 5 Jul 2026, the business days are Mon–Thu (Fri 3 Jul is the observed Independence Day, and the 4th–5th are the weekend), so the half falls on **Thursday 2 July**, giving 3 full + 0.5 = 3.5.

If a multi-calendar-day request contains only **one** business day — Fri 3 Jul – Mon 6 Jul 2026, where everything but Monday is a holiday or weekend — the formula still lands on 0.5, the same as a plain single-day request.

Per-year splitting falls out of this for free: each day is attributed to its own calendar year, so a half-day request straddling New Year puts the ½ in the year of its **last business day** and the full days wherever they fall.

**What the rule still cannot know is *which* day was the half.** It assumes the last one. In the example above the submitter actually meant the *first* day (2/11), not the Friday — the **total is right at 2.5**, but the day it is attributed to is not. Since the summary only ever reports totals, this does not affect any number on the page; it would only matter if the tally were ever broken out by individual date.

### The tally

The output is one row per **person × year × category**, with the days summed:

| Person | Year | Category | Days |
|--------|------|----------|------|
| *(example shape)* | 2026 | Time Off | 12.5 |
| | 2026 | Remote | 8 |
| | 2026 | Sick | 2 |
| | 2026 | Jury Duty | 1 |

- **Person** — the requester (`requested_by_id` / `requested_by_name`). Group by **id**, display the name; grouping by name alone re-merges people who have been renamed. All 450 current rows have a requester, so there is no "unattributed" bucket to design for.
- **Year** — the calendar year **of each counted day**, not of the request's start date. This matters for requests that straddle New Year: `2025-12-29 .. 2026-01-02` (one exists today) must contribute its December days to 2025 and its January days to 2026. Bucketing by start date alone would put all of them in 2025.
- **Days** — business days as defined above, with the last one counting `0.5` when the half-day rule applies. Fractional, so this is a decimal, not an integer.
- A person with no requests in a year has **no row** — the consumer is responsible for showing a zero rather than a gap.

### Click a person for their individual requests

Every row in the table is clickable (and keyboard-reachable — `Enter` or `Space`). Clicking opens the **right-side detail pane** listing that person's own requests, so you can see what a number is made of without leaving the page. Clicking a different person **swaps** the pane in place rather than closing it.

Each request shows:

- the **dates** — a single day, or a `start – end` span
- the **category** — Time Off / Remote / Sick / Jury Duty, as a pill
- the **counted days**, with the **½** called out where the half-day rule applied (`2.5 days (incl. ½)` plus a `½ last day` badge)
- the **submitter comment**, verbatim, or "No comment" where they left it blank

Requests are listed **most-recent first**, grouped into **year sections** (newest year first). The pane shows a person's **whole history**, not just the year selected in the table — the year selector filters the tally, not the pane.

The per-request numbers come from the same `computeOooSummary` pass that builds the table (its `details` array), so **the pane and the table can never disagree** — a unit test asserts the two totals match.

A request whose days are *all* weekend or holiday contributes 0 days and gets no pane row. Two such requests exist in the current data, which is why the pane covers 448 of the 450 rows.

---

## What the data actually looks like

Measured against the live `new_vacationrequest` mirror on **2026-08-25**: **450 rows, 38 distinct requesters**, spanning start years 2025 (174), 2026 (274) and 2027 (2).

**Request types present.** This is the whole list — the category table above covers all six:

| Type | Rows | Category |
|------|-----:|----------|
| Vacation | 311 | Time Off |
| Remote Work | 84 | Remote |
| Personal | 34 | Time Off |
| Other | 12 | Time Off |
| Sick Leave | 8 | Sick |
| Jury Duty | 1 | Jury Duty |

**Comments do arrive — the half-day rule is viable.** `description_comments` (Dataverse `new_descriptioncomments`, mapped in `lib/sync/mappers.ts` → `mapOOO`) is populated on **220 of 450** rows (49%). This was the open question before building; it is answered. The field syncs, and it carries real submitter prose.

**`duration` is not a half-day signal — do not use it.** The mirror has a `duration` column (`new_duration`, in minutes) and it looks promising until you check it. It is a *span* proxy, equal to `(calendar days − 1) × 1440` on 311 of the 330 non-null rows — so a single-day request is `0`, a two-day request is `1440`, and **a half day is indistinguishable from a full day**. It is also unreliable in its own right: **19 rows contradict the formula** (a one-day request carrying `4320`, a five-day request carrying `2880`), and 120 rows are `NULL`. Comments are the only half-day signal available.

**Half-day phrasing is messy.** The agreed pattern — which includes a **bare `half`** — matches **28** of the 450 requests: 27 single-business-day and 1 multi-day. It is a **heuristic over free text**, not a field, with three known hazards:

- **The bare `half` over-matches.** Exactly one live request is caught wrongly: *"Flying down to Charleston on 1/30 for half marathon on Saturday"* (2026-03-06) now counts **0.5** instead of 1.0. Restricting to the phrase forms (`half day` / `half a day` / `1/2 day`) would fix that one row and change nothing else — it is a one-line edit, dropping the `\bhalf\b` alternative from `HALF_DAY_RE` in `compute.ts`.
- **Hedged requests.** Four of the 28 are phrased conditionally — *"I would like to take half a day if possible - afternoon if that is ok?"*, *"Could also do a half day"*. The comment records what was **asked for**, not what was **granted**. The rule counts them as half days regardless.
- **Half days that never say "half".** *"University Fund Raiser…available until 10:00 AM for R&Co"* and *"My appearance is 1:30pm, I can host AM calls that day"* are both plainly partial days that the pattern counts as **1.0**. There is no way to catch these by regex, and no attempt should be made to guess at times in prose.

**Every request counts as approved — by decision, not just by default.** `request_status_label` is **NULL on all 450 rows**, as is `pto_type`, so there is no approval signal to filter on even if you wanted one. That matches how the firm actually operates: requests are not generally rejected, so "submitted" and "approved" are the same set in practice. This is the same choice `v_time_off` already makes ("no approval filter", [04 — Views](04-views.md)), and the summary inherits it deliberately. The only thing to watch: a request that was **submitted and then withdrawn** still sits in the mirror and still counts.

---

## Technical

### Where the data comes from

| Layer | Location |
|-------|----------|
| Dynamics entity | `new_vacationrequest` (entity set `new_vacationrequests`) |
| Sync mapping | `lib/sync/mappers.ts` → `mapOOO`, registered in `lib/sync/entities.ts` |
| Mirror table | `new_vacationrequest`, PK `ooo_id` |
| Existing calendar view | `v_time_off` → `TimeOffRow` (`lib/types.ts`) |

Fields the summary needs, all already synced: `ooo_id`, `requested_by_id`, `requested_by_name`, `start_date`, `end_date`, `request_type_label`, `description_comments`.

### Fields to ignore

- **`duration`** — see above. A broken span proxy, not a length.
- **`request_status_label`, `pto_type`** — 100% NULL.
- **`review_comments`** — the *reviewer's* note, not the submitter's. The half-day rule reads `description_comments` only.

### Dates are date-only

`start_date` / `end_date` are calendar days, inclusive of both ends; a single-day request has `start_date = end_date`. Do **not** route them through a timezone conversion — unlike the meeting views, which read Eastern days off UTC timestamps ([07 — Business Rules](07-business-rules.md)), these are already plain dates and shifting them would move requests across day boundaries. `lib/time-off/load.ts` already relies on this, parsing them with a local date-only `parseYmd`.

### Where the code lives

| Piece | File |
|-------|------|
| Rules — categories, NYSE calendar, business-day count, half-day rule, tally | `lib/ooo-summary/compute.ts` |
| Unit tests (32) | `lib/ooo-summary/compute.test.ts` |
| Page (server, reads the mirror) | `app/ooo-summary/page.tsx` |
| Table + year selector (client) | `app/ooo-summary/ooo-summary-view.tsx` |
| Click-to-detail side pane | `app/ooo-summary/ooo-person-pane.tsx` |
| Route registration (Roles matrix) | `lib/page-registry.ts` |
| Admin → Hidden Pages link | `app/admin/page.tsx`, the `HIDDEN_PAGES` array |

`computeOooSummary()` returns the tally (`rows`), the years present, `details` — every individual request with its own day count, which feeds the detail pane — and `skipped`, the count of requests dropped for a missing or inverted date (currently 0).

**The pane's chrome is the shared drawer.** `OooPersonPane` is built on the same `components/ui/sheet` primitives as `components/event-meetings-pane.tsx` (the drawer Client Detail and Outreach Status use) and reuses its shell verbatim — same `SheetContent` width and layout, same bordered header with a teal eyebrow over a navy title, same scrollable body and close affordance. It is a separate component only because `EventMeetingsPane` is typed to `MarketingEventMeeting`; if a third page ever needs this drawer, extract the shell rather than copying it again.

### Why TypeScript and not a view

The architecture's default is "views reshape, pages read" ([00 — Architecture](00-architecture.md)), and this deliberately departs from it:

- The source is **~450 rows** — far under the PostgREST 1,000-row cap, so a single fetch and an in-process rollup is cheap.
- The half-day rule is a **text heuristic**, which wants unit tests. It has them; a view would not.
- It needs **no DDL against the live database**, so there is no migration to apply and nothing to drift from `sql/03_views.sql`.
- `lib/time-off/load.ts` already does its date math in TypeScript the same way, so this is not a new pattern.

`compute.ts` is **self-contained — it imports nothing**, matching every other unit-tested module in `lib/`. That is what lets `node --test` type-strip and run it directly, and it is why the NYSE calendar lives in that file rather than a sibling.

If the row count ever approaches the fetch cap, this becomes a view; until then the tests are worth more than the SQL.

### The shape it produces

```
person_id   string     -- group key (requested_by_id)
person      string     -- display name
year        number     -- calendar year of the counted days
category    'Time Off' | 'Remote' | 'Sick' | 'Jury Duty'
days        number     -- business days, or 0.5 for a half-day request
```

The longest request in the data is **52 calendar days** (a Remote Work block), so the day-by-day walk is trivial at this scale.

### Known gaps

Carry these forward; none of them block a first version.

1. **The ½ is assumed to be the last business day.** The comment rarely says which day it was, and when it does (*"Half day on 2/11!"*) the rule ignores it. The **total is correct either way**; only per-date attribution would be wrong, and nothing reports that today. Parsing dates out of prose is a materially harder rule and is not worth it at this volume.
2. **A bare `half` over-matches.** One live request ("half marathon") counts 0.5 instead of 1.0. See the phrasing notes above — narrowing it is a one-line change.
3. **Unstated half days are counted as full days.** No regex fix exists. Only a real half-day field in Dynamics closes this.
4. **Hedged half-days are taken at face value.** The comment is a request, not a decision.
5. **New request types silently become "Time Off".** By design, but it needs a periodic look at the type list — a new type that deserves its own category (parental leave, bereavement) will look like vacation until someone notices.
6. **Everything counts as approved.** A deliberate decision — requests are not generally rejected, and request status is never populated anyway — but a withdrawn request still counts.
7. **NYSE early closes count as full days,** and unscheduled market closures are not modelled.

### If the half-day signal ever disappears

The rule depends entirely on free-text comments surviving the sync. If `description_comments` stops arriving, or if half-day phrasing gets too noisy to trust, the fallback is **not** a cleverer regex — it is a real half-day input: either a new Dynamics field on the request form, or a small Rose-owned override table keyed on `ooo_id` that the summary applies on top of the computed total. The second is the pattern the dashboard already uses for costs and salaries ([03 — Data Model](03-data-model.md)), and it keeps the correction auditable.
